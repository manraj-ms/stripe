import mongoose from 'mongoose';

const transactionSchema = new mongoose.Schema({
  last4: {
    type: String,
  },
  type: {
    type: String,
  },
  brand: {
    type: String,
  },
  amount: {
    type: Number,
  },
  currency: {
    type: String,
  },
  externalTransactionId: {
    type: String,
    unique: true,
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed'],
    default: 'pending',
  },
  subscriptionId: {
    type: String,
  },
});

const Transaction = mongoose.model('Transaction', transactionSchema);

export default Transaction;
