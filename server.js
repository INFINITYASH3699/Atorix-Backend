const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bodyParser = require("body-parser");
const sgMail = require("@sendgrid/mail");
require("dotenv").config(); // Load environment variables

const app = express();

// --- Environment Variable Checks ---
if (!process.env.SENDGRID_API_KEY) {
  console.warn("WARNING: SENDGRID_API_KEY not set.");
}
if (!process.env.MONGODB_URI) {
  console.error("ERROR: MONGODB_URI not set. Exiting.");
  process.exit(1);
}
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// --- CORS ---
const allowedOrigins = [
  "https://atorixit.com",
  "https://www.atorixit.com",
  "http://localhost:3000",
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.warn(`CORS blocked: ${origin}`);
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

app.use(bodyParser.json());

// --- MongoDB Connection ---
mongoose
  .connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("MongoDB connected"))
  .catch((err) => {
    console.error("MongoDB connection error:", err);
    process.exit(1);
  });

// --- Schema ---
const userSchema = new mongoose.Schema({
  firstName: { type: String, required: true, trim: true },
  lastName: { type: String, required: true, trim: true },
  email: { type: String, required: true, trim: true, lowercase: true },
  phone: { type: String, required: true, trim: true },
  message: { type: String, required: true, trim: true },
  demoInterest: { type: String, trim: true }, // optional
  createdAt: { type: Date, default: Date.now },
});

const User = mongoose.model("User", userSchema);

// --- POST: Submit Lead ---
app.post("/api/submit", async (req, res) => {
  const { firstName, lastName, email, phone, message, demoInterest } = req.body;

  // Validate
  if (!firstName || !lastName || !email || !phone || !message) {
    return res.status(400).json({ message: "All fields are required." });
  }

  try {
    // Check for existing entry
    const existing = await User.findOne({
      $or: [{ email }, { phone }],
    }).lean();

    if (existing) {
      let msg =
        existing.email === email
          ? "This email is already registered."
          : "This phone number is already registered.";
      return res.status(400).json({ message: msg });
    }

    // Save user
    const newUser = new User({
      firstName,
      lastName,
      email,
      phone,
      message,
      demoInterest,
    });

    await newUser.save();
    console.log("New lead saved:", newUser._id);

    // Send Email Notification
    if (
      process.env.SENDGRID_API_KEY &&
      process.env.NOTIFICATION_EMAIL &&
      process.env.SENDER_EMAIL
    ) {
      const msg = {
        to: process.env.NOTIFICATION_EMAIL,
        from: {
          email: process.env.SENDER_EMAIL,
          name: "Connecting Dots ERP",
        },
        replyTo: email,
        subject: `New Inquiry from ${firstName} ${lastName}`,
        text: `
New Lead:
Name: ${firstName} ${lastName}
Email: ${email}
Phone: ${phone}
Message: ${message}
${demoInterest ? "Interested in: " + demoInterest : ""}
Time: ${new Date().toLocaleString()}
        `,
        html: `
          <h3>New Lead Submitted</h3>
          <p><strong>Name:</strong> ${firstName} ${lastName}</p>
          <p><strong>Email:</strong> <a href="mailto:${email}">${email}</a></p>
          <p><strong>Phone:</strong> ${phone}</p>
          <p><strong>Message:</strong> ${message}</p>
          ${
            demoInterest
              ? `<p><strong>Demo Interest:</strong> ${demoInterest}</p>`
              : ""
          }
          <p><em>Submitted at: ${new Date().toLocaleString()}</em></p>
        `,
      };

      try {
        await sgMail.send(msg);
        console.log("Notification email sent.");
      } catch (err) {
        console.error("SendGrid Error:", err.response?.body || err.message);
      }
    }

    res.status(201).json({ message: "Submitted successfully!" });
  } catch (err) {
    console.error("Submit Error:", err);
    res.status(500).json({ message: "Something went wrong. Try again later." });
  }
});

// --- GET: Fetch Leads ---
app.get("/api/leads", async (req, res) => {
  try {
    const leads = await User.find().sort({ createdAt: -1 }).lean();
    res.status(200).json(leads);
  } catch (err) {
    console.error("Fetch Leads Error:", err);
    res.status(500).json({ message: "Error fetching leads." });
  }
});

// --- DELETE: Delete Lead ---
app.delete("/api/leads/:id", async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ message: "Invalid ID format." });
  }

  try {
    const deleted = await User.findByIdAndDelete(id);
    if (!deleted) {
      return res.status(404).json({ message: "Lead not found." });
    }

    res.status(200).json({ message: "Lead deleted successfully." });
  } catch (err) {
    console.error("Delete Error:", err);
    res.status(500).json({ message: "Failed to delete lead." });
  }
});

// --- Root Route ---
app.get("/", (req, res) => {
  res.status(200).send("Connecting Dots ERP Backend is live.");
});

// --- Global Error Handler ---
app.use((err, req, res, next) => {
  if (err.message === "Not allowed by CORS") {
    return res.status(403).json({ message: "CORS policy denied access." });
  }
  console.error("Unhandled Error:", err.stack || err);
  res.status(500).json({ message: "Internal server error." });
});

// --- Start Server ---
const PORT = process.env.PORT || 5001;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
