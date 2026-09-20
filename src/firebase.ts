import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getDatabase } from 'firebase/database';
import { getStorage } from 'firebase/storage';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
    apiKey: "AIzaSyC4JNHi3vudQfXus4rnCSWJXzyn1b-AC9M",
    authDomain: "dridez-93e11.firebaseapp.com",
    databaseURL: "https://dridez-93e11-default-rtdb.firebaseio.com",
    projectId: "dridez-93e11",
    storageBucket: "dridez-93e11.appspot.com",
    messagingSenderId: "408697977036",
    appId: "1:408697977036:web:d59cae8e77d2bf790a6a69",
    measurementId: "G-527CPBMJLG"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const rtdb = getDatabase(app);
export const storage = getStorage(app);

// Every read and write below is refused unless an admin is signed in — see
// schema.md section 7. Auth needs apiKey and appId above, which is why they are
// present in this config.
export const auth = getAuth(app);
