import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
      import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, updatePassword as fbUpdatePassword, onAuthStateChanged }
        from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
      import { getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, onSnapshot, serverTimestamp }
        from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

      const firebaseConfig = {
        apiKey: "AIzaSyDjDdsj3qBLi1LMsCyKGaLXb5hy4VYLnaw",
        authDomain: "neomedia-dashboard-ff830.firebaseapp.com",
        projectId: "neomedia-dashboard-ff830",
        storageBucket: "neomedia-dashboard-ff830.firebasestorage.app",
        messagingSenderId: "709755573164",
        appId: "1:709755573164:web:93ab94a663c2508bf62009",
        measurementId: "G-8VJ5RQPD6M"
      };

      const app     = initializeApp(firebaseConfig);
      const auth    = getAuth(app);
      const db      = getFirestore(app);

      // Exponer globalmente para que el resto del código (no-module) lo use
      window._fb = { auth, db, signInWithEmailAndPassword, createUserWithEmailAndPassword,
        signOut, fbUpdatePassword, onAuthStateChanged,
        doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, onSnapshot, serverTimestamp };

      // Arranque: esperar a que Firebase confirme el estado de sesión
      window._fbReady = new Promise(resolve => {
        onAuthStateChanged(auth, user => {
          window._fbCurrentAuthUser = user;
          resolve(user);
        });
      });
