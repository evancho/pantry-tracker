import { cloudErrorMessage, readCloudConfig } from './cloud-config.js';
import { createInviteCode } from './sync.js';

let apiPromise = null;

export function cloudConfigured() {
  return readCloudConfig(import.meta.env).configured;
}

async function api() {
  if (!apiPromise) {
    const { config, configured } = readCloudConfig(import.meta.env);
    if (!configured) {
      const error = new Error('這個網站還沒有雲端設定。');
      error.code = 'cloud/not-configured';
      throw error;
    }
    apiPromise = loadFirebase(config).catch((error) => {
      apiPromise = null;
      throw error;
    });
  }
  return apiPromise;
}

async function loadFirebase(config) {
  const { initializeApp } = await import('firebase/app');
  const authMod = await import('firebase/auth');
  const dbMod = await import('firebase/firestore');
  const storageMod = await import('firebase/storage');
  const app = initializeApp(config);
  const auth = authMod.getAuth(app);
  const db = dbMod.getFirestore(app);
  const storage = storageMod.getStorage(app);
  return { auth, db, storage, authMod, dbMod, storageMod };
}

function profileOf(user) {
  return {
    uid: user.uid,
    email: user.email || '',
    displayName: user.displayName || user.email || '家人',
  };
}

function ingredientFromDoc(snapshot) {
  const data = snapshot.data();
  return {
    id: snapshot.id,
    name: data.name || '',
    expiry: data.expiry || null,
    area: data.area,
    leadDays: data.leadDays,
    photoId: data.photoId || null,
    photoPath: data.photoPath || null,
    householdId: data.householdId || null,
    createdAt: data.createdAt || 0,
    updatedAt: data.updatedAt || 0,
    deletedAt: data.deletedAt || null,
  };
}

export const cloud = {
  configured: cloudConfigured,

  async currentUser() {
    const { auth } = await api();
    return auth.currentUser ? profileOf(auth.currentUser) : null;
  },

  listen(onUser) {
    let unsubscribe = () => {};
    const ready = api().then(({ auth, authMod }) => {
      unsubscribe = authMod.onAuthStateChanged(auth, (user) => {
        onUser(user ? profileOf(user) : null);
      });
    }).catch((error) => {
      onUser(null);
      throw error;
    });
    return {
      ready,
      stop() {
        ready.then(() => unsubscribe()).catch(() => {});
      },
    };
  },

  async signInGoogle() {
    const { auth, authMod } = await api();
    const provider = new authMod.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const result = await authMod.signInWithPopup(auth, provider);
    return profileOf(result.user);
  },

  async signInEmail(email, password) {
    const { auth, authMod } = await api();
    const result = await authMod.signInWithEmailAndPassword(auth, email, password);
    return profileOf(result.user);
  },

  async signUpEmail(email, password) {
    const { auth, authMod } = await api();
    const result = await authMod.createUserWithEmailAndPassword(auth, email, password);
    return profileOf(result.user);
  },

  async signOut() {
    const { auth, authMod } = await api();
    await authMod.signOut(auth);
  },

  async ensureUser(user) {
    const { db, dbMod } = await api();
    const ref = dbMod.doc(db, 'users', user.uid);
    const snapshot = await dbMod.getDoc(ref);
    if (!snapshot.exists()) {
      await dbMod.setDoc(ref, {
        email: user.email,
        displayName: user.displayName,
        activeHouseholdId: null,
        householdIds: [],
        updatedAt: Date.now(),
      });
      return { activeHouseholdId: null, householdIds: [] };
    }
    return snapshot.data();
  },

  async listHouseholds(user) {
    const record = await this.ensureUser(user);
    const ids = Array.isArray(record.householdIds) ? record.householdIds : [];
    const { db, dbMod } = await api();
    const households = [];
    for (const id of ids) {
      const householdSnap = await dbMod.getDoc(dbMod.doc(db, 'households', id));
      const memberSnap = await dbMod.getDoc(dbMod.doc(db, 'households', id, 'members', user.uid));
      if (!householdSnap.exists() || !memberSnap.exists()) continue;
      households.push({
        id,
        name: householdSnap.data().name || '家庭',
        role: memberSnap.data().role || 'member',
      });
    }
    const activeHouseholdId = households.some((row) => row.id === record.activeHouseholdId)
      ? record.activeHouseholdId
      : (households[0]?.id || null);
    return { households, activeHouseholdId };
  },

  async createHousehold(user, name) {
    const { db, dbMod } = await api();
    const id = crypto.randomUUID();
    const now = Date.now();
    const trimmed = name.trim();
    await dbMod.setDoc(dbMod.doc(db, 'households', id), {
      name: trimmed,
      createdBy: user.uid,
      createdAt: now,
      updatedAt: now,
    });
    await dbMod.setDoc(dbMod.doc(db, 'households', id, 'members', user.uid), {
      role: 'admin',
      email: user.email,
      displayName: user.displayName,
      updatedAt: now,
    });
    await dbMod.setDoc(dbMod.doc(db, 'users', user.uid), {
      email: user.email,
      displayName: user.displayName,
      activeHouseholdId: id,
      householdIds: dbMod.arrayUnion(id),
      updatedAt: now,
    }, { merge: true });
    return { id, name: trimmed, role: 'admin' };
  },

  async switchHousehold(user, householdId) {
    const { db, dbMod } = await api();
    await dbMod.setDoc(dbMod.doc(db, 'users', user.uid), {
      activeHouseholdId: householdId,
      updatedAt: Date.now(),
    }, { merge: true });
  },

  async createInvite(user, household) {
    const { db, dbMod } = await api();
    const code = createInviteCode();
    const now = Date.now();
    await dbMod.setDoc(dbMod.doc(db, 'invites', code), {
      code,
      householdId: household.id,
      householdName: household.name,
      role: 'member',
      createdBy: user.uid,
      createdAt: now,
      expiresAt: now + 30 * 86400000,
    });
    return code;
  },

  async getInvite(code) {
    const { db, dbMod } = await api();
    const snapshot = await dbMod.getDoc(dbMod.doc(db, 'invites', code));
    if (!snapshot.exists()) return null;
    return snapshot.data();
  },

  async joinHousehold(user, invite) {
    const { db, dbMod } = await api();
    const now = Date.now();
    await dbMod.setDoc(dbMod.doc(db, 'households', invite.householdId, 'members', user.uid), {
      role: invite.role || 'member',
      email: user.email,
      displayName: user.displayName,
      inviteCode: invite.code,
      updatedAt: now,
    });
    await dbMod.setDoc(dbMod.doc(db, 'users', user.uid), {
      activeHouseholdId: invite.householdId,
      householdIds: dbMod.arrayUnion(invite.householdId),
      updatedAt: now,
    }, { merge: true });
  },

  async listIngredients(householdId) {
    const { db, dbMod } = await api();
    const snapshot = await dbMod.getDocs(dbMod.collection(db, 'households', householdId, 'ingredients'));
    return snapshot.docs.map(ingredientFromDoc);
  },

  async writeIngredient(item) {
    const { db, dbMod } = await api();
    await dbMod.setDoc(dbMod.doc(db, 'households', item.householdId, 'ingredients', item.id), {
      name: item.name || '',
      expiry: item.expiry || null,
      area: item.area || '冷藏',
      leadDays: item.leadDays ?? 1,
      photoId: item.photoId || null,
      photoPath: item.photoPath || null,
      householdId: item.householdId,
      createdAt: item.createdAt || item.updatedAt || Date.now(),
      updatedAt: item.updatedAt || Date.now(),
      deletedAt: item.deletedAt || null,
    });
  },

  async uploadPhoto(householdId, photoId, blob) {
    const { storage, storageMod } = await api();
    const path = `households/${householdId}/${photoId}.jpg`;
    await storageMod.uploadBytes(storageMod.ref(storage, path), blob, {
      contentType: blob.type || 'image/jpeg',
    });
    return path;
  },

  async downloadPhoto(path) {
    const { storage, storageMod } = await api();
    return storageMod.getBytes(storageMod.ref(storage, path));
  },

  async deletePhoto(path) {
    if (!path) return;
    const { storage, storageMod } = await api();
    try {
      await storageMod.deleteObject(storageMod.ref(storage, path));
    } catch (error) {
      if (error?.code !== 'storage/object-not-found') throw error;
    }
  },
};

export function explainCloudError(error) {
  if (error?.message && /[\u4e00-\u9fff]/.test(error.message) && !error.code) return error.message;
  return cloudErrorMessage(error);
}
