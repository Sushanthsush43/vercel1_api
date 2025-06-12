const admin = require("firebase-admin");
   const express = require("express");
   const cors = require("cors");

   const app = express();
   app.use(cors({ origin: true }));
   app.use(express.json());

   // Initialize Firebase Admin SDK using environment variables
   if (!admin.apps.length) {
     admin.initializeApp({
       credential: admin.credential.cert({
         projectId: process.env.FIREBASE_PROJECT_ID,
         clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
         privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
       }),
     });
   }

   const db = admin.firestore();

   /**
    * Generates a random 6-digit OTP.
    * @returns {string} A 6-digit OTP.
    */
   function generateOTP() {
     return Math.floor(100000 + Math.random() * 900000).toString();
   }

   /**
    * Stores an OTP in Firestore with a 10-minute expiration.
    * @param {string} phoneNumber - The phone number to associate with the OTP.
    * @param {string} otp - The OTP to store.
    * @returns {Promise<void>}
    */
   async function storeOTP(phoneNumber, otp) {
     const expiresAt = admin.firestore.Timestamp.fromDate(
       new Date(Date.now() + 10 * 60 * 1000),
     );

     await db.collection("pendingVerifications").doc(phoneNumber).set({
       otp,
       expiresAt,
       createdAt: admin.firestore.FieldValue.serverTimestamp(),
     });
   }

   /**
    * Logs in a user by generating an OTP if the phone number exists.
    */
   module.exports = async (req, res) => {
     if (req.method !== "POST") {
       return res.status(405).json({ error: "Method not allowed" });
     }

     const { phoneNumber } = req.body;

     if (!phoneNumber) {
       return res.status(400).json({ error: "Phone number is required" });
     }

     try {
       // Check if phone number exists in Firestore
       const snapshot = await db
         .collection("users")
         .where("phoneNumber", "==", phoneNumber)
         .get();

       if (snapshot.empty) {
         return res.status(404).json({ error: "Phone number not registered" });
       }

       // Generate OTP
       const otp = generateOTP();

       // Store OTP temporarily with expiration
       await storeOTP(phoneNumber, otp);

       // Get userId from the snapshot
       const userDoc = snapshot.docs[0];
       const userId = userDoc.data().userId;

       // Return OTP and userId
       res.status(200).json({ message: "OTP generated", userId, otp });
     } catch (error) {
       console.error("Error in login:", error);
       res.status(500).json({ error: "Server error" });
     }
   };
