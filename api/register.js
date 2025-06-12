const admin = require("firebase-admin");
const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

// Initialize Firebase Admin SDK using environment variables
try {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      }),
    });
    console.log("Firebase Admin SDK initialized successfully");
  }
} catch (error) {
  console.error("Failed to initialize Firebase Admin SDK:", error.message);
  throw new Error("Firebase initialization failed");
}

const db = admin.firestore();

/**
 * Gets the next auto-incrementing user ID using a transaction.
 * @returns {Promise<number>} The next user ID.
 */
async function getNextUserId() {
  const counterRef = db.collection("metadata").doc("userCounter");

  return db.runTransaction(async (transaction) => {
    const counterDoc = await transaction.get(counterRef);
    let newId;

    if (!counterDoc.exists) {
      newId = 1;
      transaction.set(counterRef, { lastId: newId });
    } else {
      newId = counterDoc.data().lastId + 1;
      transaction.update(counterRef, { lastId: newId });
    }

    return newId;
  });
}

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
 * Registers a new user and generates an OTP.
 */
module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { phoneNumber, fullName, email } = req.body;

  if (!phoneNumber || !fullName || !email) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    console.log(`Processing register request for phone: ${phoneNumber}`);

    // Check if phone number or email already exists
    const phoneSnapshot = await db
      .collection("users")
      .where("phoneNumber", "==", phoneNumber)
      .get();
    const emailSnapshot = await db
      .collection("users")
      .where("email", "==", email)
      .get();

    if (!phoneSnapshot.empty) {
      return res.status(400).json({ error: "Phone number already registered" });
    }

    if (!emailSnapshot.empty) {
      return res.status(400).json({ error: "Email already registered" });
    }

    // Generate unique user ID
    const userId = await getNextUserId();
    console.log(`Generated userId: ${userId}`);

    // Generate OTP
    const otp = generateOTP();
    console.log(`Generated OTP: ${otp}`);

    // Store OTP temporarily with expiration
    await storeOTP(phoneNumber, otp);
    console.log(`Stored OTP for phone: ${phoneNumber}`);

    // Store user data in Firestore
    await db.collection("users").doc(userId.toString()).set({
      userId,
      fullName,
      phoneNumber,
      email,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`Stored user data for userId: ${userId}`);

    // Return OTP and userId
    res.status(200).json({ message: "OTP generated", userId, otp });
  } catch (error) {
    console.error("Error in register:", error.message);
    res.status(500).json({ error: "Server error", details: error.message });
  }
};
