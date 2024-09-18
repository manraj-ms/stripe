import express from 'express';
import Stripe from 'stripe';
import bodyParser from 'body-parser';
import Transaction from '../models/transaction.js';
import Subscription from '../models/subscription.js';
import connectDB from './db.js';

const app = express();
const port = 3000;
const stripe = Stripe("sk_test_51PyuSpAYJtslMxFQcJVYN53gwdfLYvKmqrRr1ykI4bFCX8iFqSB57M1Ehos4S879inx4eogZFm7qLNSuGFHbapQl00qslkOeEP");

connectDB();

app.use(
  (req, res, next) => {
    if (req.originalUrl === '/webhook') {
      next();
    } else {
      bodyParser.json()(req, res, next);
    }
  }
);

app.post('/subscribe', async (req, res) => {
  const { email, paymentMethodId } = req.body;

  try {
    const customer = await stripe.customers.create({
      email: email,
      payment_method: paymentMethodId,
      invoice_settings: {
        default_payment_method: paymentMethodId,
      },
    });

    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: 'price_1Q0KjDAYJtslMxFQRDAEroYB' }], // Replace with your actual price ID
      expand: ['latest_invoice.payment_intent'],
    });

    const newSubscription = new Subscription({
      customerId: customer.id,
      subscriptionId: subscription.id,
      status: subscription.status,
      amount: subscription.items.data[0].price.unit_amount / 100,
      currency: subscription.items.data[0].price.currency,
      billingCycle: subscription.items.data[0].price.recurring.interval,
    });

    await newSubscription.save();

    res.status(200).json({
      success: true,
      subscription,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

app.post('/charge', async (req, res) => {
  const { amount, currency, paymentMethodId, email } = req.body;

  try {
    const customer = await stripe.customers.create({
      email: email,
    });

    await stripe.paymentMethods.attach(paymentMethodId, {
      customer: customer.id,
    });

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount * 100,
      currency: currency,
      customer: customer.id,
      payment_method: paymentMethodId,
      confirmation_method: 'automatic',
      confirm: true,
      return_url: "https://google.com"
    });

    const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);

    const last4 = paymentMethod.card.last4;
    const cardBrand = paymentMethod.card.brand;
    const paymentType = paymentMethod.type;

    const transaction = new Transaction({
      amount: amount,
      currency: currency,
      externalTransactionId: paymentIntent.id,
      last4,
      brand: cardBrand,
      type: paymentType,
      status: 'pending',
    });

    await transaction.save();

    res.status(200).json({
      success: true,
      message: 'Payment successful',
      paymentIntent,
      cardDetails: {
        last4,
        cardBrand,
        paymentType,
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      'whsec_6eadb0627b896ba2e3be79ffc94a46c3caad7e71fea1f7d58df1d048d6d0fac9'
    );
  } catch (err) {
    console.error(`⚠️  Webhook signature verification failed: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  switch (event.type) {
    case 'payment_intent.created':
      const createdPaymentIntent = event.data.object;
      const newTransaction = new Transaction({
        amount: createdPaymentIntent.amount / 100,
        currency: createdPaymentIntent.currency,
        externalTransactionId: createdPaymentIntent.id,
        status: 'pending'
      });
      await newTransaction.save();
      break;

    case 'payment_intent.succeeded':
      const succeededPaymentIntent = event.data.object;

      try {
        const paymentIntentDetails = await stripe.paymentIntents.retrieve(succeededPaymentIntent.id);
        const chargeId = paymentIntentDetails.latest_charge;
        const charge = await stripe.charges.retrieve(chargeId);
        const chargeDetails = charge.payment_method_details;

        if (!chargeDetails || !chargeDetails.card) {
          console.error(`Charge details missing for PaymentIntent: ${succeededPaymentIntent.id}`);
          return res.status(400).send('Charge details missing');
        }

        await Transaction.findOneAndUpdate(
          { externalTransactionId: succeededPaymentIntent.id },
          {
            status: 'completed',
            last4: chargeDetails.card.last4,
            type: chargeDetails.type,
            brand: chargeDetails.card.brand
          },
          { new: true }
        );
        console.log(`PaymentIntent succeeded: ${succeededPaymentIntent.id}`);
      } catch (error) {
        console.error(`Failed to process PaymentIntent: ${error.message}`);
        return res.status(500).send('Failed to retrieve PaymentIntent details');
      }
      break;

    case 'charge.failed':
      const failedCharge = event.data.object;
      await Transaction.findOneAndUpdate(
        { externalTransactionId: failedCharge.payment_intent },
        { status: 'failed' },
        { new: true }
      );
      console.log(`Charge failed: ${failedCharge.id}`);
      break;

    case 'invoice.payment_succeeded':
      const invoice = event.data.object;
      const subscription = invoice.subscription;
      await Subscription.findOneAndUpdate(
        { subscriptionId: subscription },
        { status: 'active' },
        { new: true }
      );
      console.log(`Invoice payment succeeded for subscription: ${subscription}`);
      break;

    case 'invoice.payment_failed':
      const failedInvoice = event.data.object;
      const failedSubscription = failedInvoice.subscription;
      await Subscription.findOneAndUpdate(
        { subscriptionId: failedSubscription },
        { status: 'canceled' },
        { new: true }
      );
      console.log(`Invoice payment failed for subscription: ${failedSubscription}`);
      break;

    default:
      console.log(`Unhandled event type: ${event.type}`);
  }

  res.json({ received: true });
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
