let express = require('express');
let router = express.Router();
let mongoose = require('mongoose');

let modelReservation = require('../schemas/reservations');
let modelCart = require('../schemas/cart');
let modelInventory = require('../schemas/inventories');
let modelProduct = require('../schemas/products');
let { checkLogin } = require('../utils/authHandler.js.js');

// get reservations/ -> get all of user
router.get('/', checkLogin, async (req, res) => {
    try {
        let reservations = await modelReservation.find({ user: req.userId }).populate('items.product');
        res.send(reservations);
    } catch (e) {
        res.status(500).send({ message: e.message });
    }
});

// get reservations/:id -> get 1 of user
router.get('/:id', checkLogin, async (req, res) => {
    try {
        let reservation = await modelReservation.findOne({ _id: req.params.id, user: req.userId }).populate('items.product');
        if (!reservation) {
            return res.status(404).send({ message: 'Reservation not found' });
        }
        res.send(reservation);
    } catch (e) {
        res.status(500).send({ message: e.message });
    }
});

// reserveACart -> post reserveACart/
router.post('/reserveACart', checkLogin, async (req, res) => {
    let session = await mongoose.startSession();
    let transaction = session.startTransaction();
    try {
        let cart = await modelCart.findOne({ user: req.userId }).populate('items.product');
        if (!cart || cart.items.length === 0) {
            throw new Error("Cart is empty");
        }

        let itemsForReservation = [];
        let totalAmount = 0;

        for (let item of cart.items) {
            let inventory = await modelInventory.findOne({ product: item.product._id });
            if (!inventory || (inventory.stock - inventory.reserved) < item.quantity) {
                throw new Error("Not enough stock for product " + item.product.title);
            }
            inventory.reserved += item.quantity;
            await inventory.save({ session });

            let subtotal = item.quantity * item.product.price;
            itemsForReservation.push({
                product: item.product._id,
                quantity: item.quantity,
                price: item.product.price,
                subtotal: subtotal
            });
            totalAmount += subtotal;
        }

        let newReservation = new modelReservation({
            user: req.userId,
            items: itemsForReservation,
            totalAmount: totalAmount,
            status: "actived",
            ExpiredAt: new Date(Date.now() + 15 * 60 * 1000)
        });
        await newReservation.save({ session });

        cart.items = [];
        await cart.save({ session });

        await session.commitTransaction();
        session.endSession();
        res.send(newReservation);
    } catch (e) {
        await session.abortTransaction();
        session.endSession();
        res.status(400).send({ message: e.message });
    }
});

// reserveItems -> post reserveItems/ {body gồm list product va quantity}
router.post('/reserveItems', checkLogin, async (req, res) => {
    let session = await mongoose.startSession();
    let transaction = session.startTransaction();
    try {
        let inputItems = req.body.items || req.body;
        if (!Array.isArray(inputItems) || inputItems.length === 0) {
            throw new Error("Invalid items");
        }

        let itemsForReservation = [];
        let totalAmount = 0;

        for (let item of inputItems) {
            let product = await modelProduct.findById(item.product);
            if (!product) {
                throw new Error("Product not found: " + item.product);
            }

            let inventory = await modelInventory.findOne({ product: product._id });
            if (!inventory || (inventory.stock - inventory.reserved) < item.quantity) {
                throw new Error("Not enough stock for product " + product.title);
            }
            inventory.reserved += item.quantity;
            await inventory.save({ session });

            let subtotal = item.quantity * product.price;
            itemsForReservation.push({
                product: product._id,
                quantity: item.quantity,
                price: product.price,
                subtotal: subtotal
            });
            totalAmount += subtotal;
        }

        let newReservation = new modelReservation({
            user: req.userId,
            items: itemsForReservation,
            totalAmount: totalAmount,
            status: "actived",
            ExpiredAt: new Date(Date.now() + 15 * 60 * 1000)
        });
        await newReservation.save({ session });

        await session.commitTransaction();
        session.endSession();
        res.send(newReservation);
    } catch (e) {
        await session.abortTransaction();
        session.endSession();
        res.status(400).send({ message: e.message });
    }
});

// cancelReserve -> post cancelReserve/:id
router.post('/cancelReserve/:id', checkLogin, async (req, res) => {
    try {
        let reservation = await modelReservation.findOne({ _id: req.params.id, user: req.userId });
        if (!reservation) {
            return res.status(404).send({ message: "Reservation not found" });
        }
        if (reservation.status !== "actived") {
            return res.status(400).send({ message: "Reservation cannot be cancelled" });
        }
        
        reservation.status = "cancelled";

        // Without transaction as instructed: (trừ cancel phải để trong transaction)
        for (let item of reservation.items) {
            let inventory = await modelInventory.findOne({ product: item.product });
            if (inventory) {
                inventory.reserved -= item.quantity;
                if (inventory.reserved < 0) inventory.reserved = 0;
                await inventory.save(); 
            }
        }
        
        await reservation.save();
        
        res.send(reservation);
    } catch (e) {
        res.status(400).send({ message: e.message });
    }
});

module.exports = router;
