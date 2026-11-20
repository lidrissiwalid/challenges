import mongoose, { Document, Schema } from 'mongoose';

// ── Customer (player-facing authentication collection) ──────────────────────
// Administrators are NOT stored here. NoSQL injection can only yield a
// customer session regardless of operator abuse.
export interface ICustomer extends Document {
  email: string;
  password: string;
  name: string;
  createdAt: Date;
}

const CustomerSchema = new Schema<ICustomer>({
  email:     { type: String, required: true, unique: true, index: true },
  password:  { type: String, required: true },
  name:      { type: String, required: true },
  createdAt: { type: Date,   default: () => new Date() },
});

export const Customer = mongoose.model<ICustomer>('Customer', CustomerSchema);

// ── Support message ──────────────────────────────────────────────────────────
export interface IMessage extends Document {
  customerId: string;
  customerEmail: string;
  subject: string;
  // content is stored raw and rendered unsafely only in the admin view
  content: string;
  createdAt: Date;
  visitedByAdmin: boolean;
}

const MessageSchema = new Schema<IMessage>({
  customerId:    { type: String, required: true, index: true },
  customerEmail: { type: String, required: true },
  subject:       { type: String, required: true },
  content:       { type: String, required: true },
  createdAt:     { type: Date,   default: () => new Date() },
  visitedByAdmin:{ type: Boolean, default: false },
});

export const Message = mongoose.model<IMessage>('Message', MessageSchema);

// ── Capture inbox ────────────────────────────────────────────────────────────
// Stores the administrator cookie captured by an XSS payload.
// Each capture is associated with the message that triggered it and the
// customer who sent that message. Only the originating customer can read it.
export interface ICapture extends Document {
  messageId: string;
  customerId: string;
  capturedValue: string;
  capturedAt: Date;
}

const CaptureSchema = new Schema<ICapture>({
  messageId:     { type: String, required: true, unique: true },
  customerId:    { type: String, required: true, index: true },
  capturedValue: { type: String, required: true },
  capturedAt:    { type: Date,   default: () => new Date() },
});

export const Capture = mongoose.model<ICapture>('Capture', CaptureSchema);
