import mongoose from 'mongoose';

const subscriptionSchema = new mongoose.Schema({
  customerId: {
    type: String,
    required: true,
  },
  subscriptionId: {
    type: String,
    required: true,
    unique: true,
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'canceled'],
    default: 'active',
  },
  amount: {
    type: Number,
  },
  currency: {
    type: String,
  },
  billingCycle: {
    type: String,
  },
});

const Subscription = mongoose.model('Subscription', subscriptionSchema);

export default Subscription;
