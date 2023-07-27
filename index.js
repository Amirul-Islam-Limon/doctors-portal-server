const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require("dotenv").config();
const jwt = require('jsonwebtoken');
const stripe = require("stripe", process.env.STRIPE_PRIVATE_KEY)
const port = process.env.PORT || 5000;
const app = express();

// middleware
app.use(cors());
app.use(express.json());



function verifyJWT(req, res, next){
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.status(401).send("unauthorized access");
  }
  const token = authHeader.split(" ")[1];

  jwt.verify(token, process.env.ACCESS_TOKEN, function (err, decoded) {
    if (err) {
      console.log(err);
      return res.status(403).send({message:"forbidden access1"})
    }
    req.decoded = decoded
    next();
  })
}



const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.djwtpf9.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {serverApi: {version: ServerApiVersion.v1,strict: true,deprecationErrors: true,}});
async function run() {
  try {
    const appointmentOptionCollection = client.db("doctorsPortal").collection("appointmentOptions");
    const bookingCollection = client.db("doctorsPortal").collection("bookings");
    const userCollection = client.db("doctorsPortal").collection("users");
    const doctorsCollection = client.db("doctorsPortal").collection("doctors");


// Make sure you use verify admin after verifyJWT
    const verifyAdmin = async(req, res, next) => {
      // console.log(req.decoded.email);
      const decodedEmail = req.decoded.email;
      const query = { email: decodedEmail };
      const user = await userCollection.findOne(query);

      if (user?.role !== "admin") {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    }



    app.get("/appointmentOptions", async (req, res) => {
      const date = req.query.date;
      const query = {};
      const options = await appointmentOptionCollection.find(query).toArray();
      const bookingQuery = { appointmentDate: date };
      const alreadyBooked = await bookingCollection.find(bookingQuery).toArray();

      options.forEach(option => {
        // for this perticular option which which time selected
        const optionBooked = alreadyBooked.filter(book=> book.treatmentName === option.name)
        const bookedSlots = optionBooked.map(book => book.slot)
        // console.log(bookedSlots);
        const remainingSlots = option.slots.filter(slot=> !bookedSlots.includes(slot))
        option.slots = remainingSlots;
        // console.log(option.name,bookedSlots, remainingSlots.length);
      })
      res.send(options);
    })



    app.get("/appointmentSpecialty", async (req, res) => {
      const query = {}
      const results = await appointmentOptionCollection.find(query).project({
        name: 1
      }).toArray();
      res.send(results);
    })



    app.get("/bookings", verifyJWT, async (req, res) => {
      const email = req.query.email;
      const decodedEmail = req.decoded.email;

      if (email !== decodedEmail) {
        return res.status(403).send({message:"forbidden access"})
      }

      const query = { email: email }
      const bookings = await bookingCollection.find(query).toArray();
      res.send(bookings);
    })



    app.post("/bookings", async (req, res) => {
      const booking = req.body;
      const query = {
        appointmentDate: booking.appointmentDate,
        treatmentName: booking.treatmentName,
        email: booking.email
      }
      
      const alreadyBooked = await bookingCollection.find(query).toArray();
      // console.log(query, alreadyBooked);
      if (alreadyBooked.length > 0) {
        const message = `You already have a booking on ${booking.appointmentDate}`
        return res.send({acknowledged:false, message:message})
      }
      const result = await bookingCollection.insertOne(booking);
      res.send(result);
    })



    app.get("/bookings/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await bookingCollection.findOne(query);
      res.send(result);
    })



    app.get("/jwt", async (req, res) => {
      const email = req.query.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      if (user) {
        const token = jwt.sign({email}, process.env.ACCESS_TOKEN, { expiresIn: '24h' })
        return res.send({ accessToken: token });
      }
      res.status(403).send({accessToken:""});
    })



// everything for about stripe
// const storedItems = new Map([
//   [1,{ price: 93, name: "teath cleaning" }],
//   [2,{price:99, name:"Teath Serjery"}]
// ])

    
    
    app.get("/create-checkout-session", async (req, res) => {
      try {
        const session = await stripe.checkout.sessions.create({
          payment_method_types: ["card"],
          mode: "payment",
          line_items: req.body.items.map(item => {
            const storedItem = storedItems.get(item.id)
          }),
          success_url:"http://localhost:3000/dashboard/payment/success",
          cancel_url:"http://localhost:3000/dashboard/payment/cancel",
        })
      }
      catch(error) {
        res.status(500).json({error:error.message})
      }
      res.json({ url:"hi" });
    })


    
    app.get("/users", verifyJWT, async (req, res) => {
      const decodedEmail = req.decoded.email;
      const query = { email: decodedEmail };
      const user = await userCollection.findOne(query);

      if (user?.role !== "admin") {
        return res.status(403).send({ message: "forbidden access" });
      }
      const result = await userCollection.find({}).sort({_id:-1}).toArray();
      res.send(result);
    })


    app.post("/users", async (req, res) => {
      const user = req.body;
      const result = await userCollection.insertOne(user);
      res.send(result);
    })



    app.put("/users/admin/:id", verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const options = { upsert: true };
      const updatedDoc = {
        $set: {
          role:"admin"
        }
      }
      const results = await userCollection.updateOne(filter, updatedDoc, options,);
      res.send(results);
    })




    app.get("/users/admin/:email", async (req, res) => {
      const email = req.params.email;
      const query = {email:email};
      const user = await userCollection.findOne(query);
      res.send({isAdmin: user?.role === "admin"})
    })



    app.get("/doctors", verifyJWT, verifyAdmin, async(req, res) => {
      const query = {};
      const results = await doctorsCollection.find(query).sort({_id:-1}).toArray();
      res.send(results);

    })



    app.post("/doctors", verifyJWT, async(req, res) => {
      const doctor = req.body;
      const results = await doctorsCollection.insertOne(doctor)
      res.send(results);
    })



    app.delete("/doctors/:id", verifyJWT, async (req, res) => {
      const id = req.params.id;
      console.log(id);
      const filter = { _id: new ObjectId(id) };
      const results = await doctorsCollection.deleteOne(filter);
      res.send(results);
    })



  }
  finally {
    
  }
}
run().catch(console.dir);


app.get("/", (req, res) => {
    res.send("Doctors Portal server is running!  YAY")
})


app.listen(port, () => console.log(`Doctors Portal running on port ${port}`));

