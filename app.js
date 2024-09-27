import express from 'express';
import bodyParser from 'body-parser';
import session from 'express-session';
import bcrypt from 'bcrypt';
import db from './config/db.js';
import dotenv from 'dotenv';
import multer from 'multer';
import path from 'path';
import Razorpay from 'razorpay';
import axios from 'axios';
dotenv.config();
                 
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, './public/uploads');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 1024 * 1024 * 5 } 
});

const app = express();
const port = 3000;
const saltRounds = 10;

app.use(bodyParser.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.set('views', './views');
app.use(express.static('public'));
app.use(express.json());

app.use(session({
  secret: process.env.SESSION_SECRET || 'your_secret_key',
  resave: false,
  saveUninitialized: true,
}));

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID, 
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

app.use((req, res, next) => {
  res.locals.cartCount = req.session.cart ? req.session.cart.length : 0;
  next(); 
});

app.get('/', (req, res) => {
  res.redirect('/seller/login');
});

app.get('/customer/login', (req, res) => {
  res.render('customer/customerLogin', { message: '' });
});

app.get('/register/customer', (req, res) => {
  res.render('customer/customerRegister', { message: '' });
});

app.get('/seller/login', (req, res) => {
  res.render('seller/sellerLogin', { message: '' });
});

app.get('/register/seller', (req, res) => {
  res.render('seller/sellerRegister', { message: '' });
});

app.get('/seller/bankDetails', async (req, res) => {
  const sellerId = req.session.sellerId; 
  const sellerName = req.session.sellerName;

  try {
    const result = await db.query('SELECT * FROM bank_details WHERE seller_id = $1', [sellerId]);
    const editMode = result.rows.length > 0;
    res.render('seller/bankDetails', {
      sellerName: sellerName,
      editMode: editMode, 
      message: '',
      bankDetails: result.rows[0] || {} 
    });
  } catch (error) {
    console.error('Error fetching bank details:', error);
    res.render('seller/bankDetails', { 
      sellerName: sellerName,
      message: 'Error fetching bank details. Please try again.',
      editMode: false, 
      bankDetails: {}
    });
  }
});

app.post('/seller/bankDetails', async (req, res) => {
  const sellerId = req.session.sellerId;
  const sellerName = req.session.sellerName;

  const { bankName, accHolderName, accNumber, IFSC, bank_branch, contact } = req.body;

  try {
    const result = await db.query('SELECT * FROM bank_details WHERE seller_id = $1', [sellerId]);
    const editMode = result.rows.length > 0; 

    if (editMode) {
      const updateQuery = 'UPDATE bank_details SET bank_name=$1, account_holder_name=$2, account_number=$3, ifsc_code=$4, bank_branch=$5, contact_number=$6 WHERE seller_id = $7';
      await db.query(updateQuery, [bankName, accHolderName, accNumber, IFSC, bank_branch, contact, sellerId]);
      res.redirect('/seller/home');
    } else {
      const insertQuery = 'INSERT INTO bank_details (seller_id, bank_name, account_holder_name, account_number, ifsc_code, bank_branch, contact_number) VALUES ($1, $2, $3, $4, $5, $6, $7)';
      await db.query(insertQuery, [sellerId, bankName, accHolderName, accNumber, IFSC, bank_branch, contact]);
      res.redirect('/seller/home');
    }
  } catch (error) {
    console.error('Error adding/updating bank details:', error);
    const result = await db.query('SELECT * FROM bank_details WHERE seller_id = $1', [sellerId]);
    const editMode = result.rows.length > 0; 
    res.render('seller/bankDetails', {
      sellerName: sellerName,
      message: 'Error adding/updating bank details. Please try again.',
      editMode: editMode, 
      bankDetails: { bank_name: bankName, account_holder_name: accHolderName, account_number: accNumber, ifsc_code: IFSC, bank_branch: bank_branch, contact_number: contact } // Keep user input
    });
  }
});

const isAuthenticatedSeller = (req, res, next) => {
  if (req.session.sellerId) {
    return next(); 
  } else {
    return res.redirect('/seller/login'); 
  }
};

const isAuthenticatedCustomer = (req, res, next) => {
  if (req.session.customerId) {
    return next(); 
  } else {
    return res.redirect('/customer/login'); 
  }
};

app.post('/register/customer', async (req, res) => {
  const { name, address, email, password, confirmpassword } = req.body;

  if (password !== confirmpassword) {
    return res.render('customer/customerRegister', { message: 'Passwords do not match.' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    db.query('SELECT * FROM customers WHERE email = $1', [email], (err, result) => {
      if (err) {
        console.error('Error during registration:', err);
        return res.render('customer/customerRegister', { message: 'Error during registration. Please try again.' });
      } else if (result.rows.length > 0) {
        return res.render('customer/customerRegister', { message: 'User already exists. Please try a different one.' });
      } else {
        db.query('INSERT INTO customers (name, address, email, password) VALUES ($1, $2, $3, $4)', [name, address, email, hashedPassword], (err) => {
          if (err) {
            console.error('Error registering:', err);
            return res.render('customer/customerRegister', { message: 'Error during registration. Please try again.' });
          } else {
            res.redirect('/customer/login');
          }
        });
      }
    });
  } catch (error) {
    console.error('Error hashing password:', error);
    res.render('customer/customerRegister', { message: 'Error during registration. Please try again.' });
  }
});

app.post('/customer/login', async (req, res) => {
  const { email, password } = req.body;

  db.query('SELECT * FROM customers WHERE email = $1', [email], async (err, result) => {
    if (err) {
      console.error('Error during customer login:', err);
      return res.render('customer/customerLogin', { message: 'Error during login. Please try again.' });
    }
    if (result.rows.length > 0) {
      const user = result.rows[0];
      const match = await bcrypt.compare(password, user.password);
      if (match) {
        req.session.customerId = user.id;
        req.session.customerName = user.name;
        res.redirect('/customer/home');
      } else {
        res.render('customer/customerLogin', { message: 'Invalid credentials. Please try again.' });
      }
    } else {
      res.render('customer/customerLogin', { message: 'User does not exist. Please register.' });
    }
  });
});

app.post('/register/seller', async (req, res) => {
  const { name, address, email, password, confirmpassword } = req.body;

  if (password !== confirmpassword) {
    return res.render('seller/sellerRegister', { message: 'Passwords do not match.' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    db.query('SELECT * FROM sellers WHERE email = $1', [email], (err, result) => {
      if (err) {
        console.error('Error during registration:', err);
        return res.render('seller/sellerRegister', { message: 'Error during registration. Please try again.' });
      } else if (result.rows.length > 0) {
        return res.render('seller/sellerRegister', { message: 'User already exists. Please try a different one.' });
      } else {
        db.query('INSERT INTO sellers (name, address, email, password) VALUES ($1, $2, $3, $4)', [name, address, email, hashedPassword], (err) => {
          if (err) {
            console.error('Error registering:', err);
            return res.render('seller/sellerRegister', { message: 'Error during registration. Please try again.' });
          } else {
            res.redirect('/seller/login');
          }
        });
      }
    });
  } catch (error) {
    console.error('Error hashing password:', error);
    res.render('seller/sellerRegister', { message: 'Error during registration. Please try again.' });
  }
});

app.post('/seller/login', async (req, res) => {
  const { email, password } = req.body;

  db.query('SELECT * FROM sellers WHERE email = $1', [email], async (err, result) => {
    if (err) {
      console.error('Error during seller login:', err);
      return res.render('seller/sellerLogin', { message: 'Error during login. Please try again.' });
    }
    if (result.rows.length > 0) {
      const user = result.rows[0];
      const match = await bcrypt.compare(password, user.password);
      if (match) {
        req.session.sellerId = user.id;
        req.session.sellerName = user.name;
        res.redirect('/seller/home');
      } else {
        res.render('seller/sellerLogin', { message: 'Invalid credentials. Please try again.' });
      }
    } else {
      res.render('seller/sellerLogin', { message: 'User does not exist. Please register.' });
    }
  });
});

app.get('/customer/home', isAuthenticatedCustomer, (req, res) => {
  const customerId = req.session.customerId;
  const customerName = req.session.customerName;

  db.query('SELECT id, name, address, rating FROM sellers', (err, result) => {
    if (err) {
      console.error('Error fetching sellers:', err);
      return res.render('customer/customerHome', { customerName, message: 'Error fetching sellers. Please try again.', sellers: [] });
    }

    res.render('customer/customerHome', {
      customerName: customerName,
      sellers: result.rows,
      message: ''
    });
  });
});

app.get('/seller/home', isAuthenticatedSeller, (req, res) => {
  const sellerId = req.session.sellerId;
  const sellerName = req.session.sellerName;

  res.render('seller/sellerHome', {
    sellerId: sellerId,
    sellerName: sellerName,
    message:''
  });
});

app.post('/rate-seller/:id/:rating', (req, res) => {
  const sellerId = req.params.id;
  let newRating = parseFloat(req.params.rating);

  if (isNaN(newRating)) {
    newRating = 0;
  }

  db.query('SELECT rating, rating_count FROM sellers WHERE id = $1', [sellerId], (err, result) => {
    if (err) {
      console.error('Error fetching seller:', err);
      return res.json({ success: false });
    }

    const seller = result.rows[0];
    const currentRating = seller.rating || 0;
    const ratingCount = seller.rating_count || 0;

    const updatedRating = ((currentRating * ratingCount) + newRating) / (ratingCount + 1);

    db.query('UPDATE sellers SET rating = $1, rating_count = $2 WHERE id = $3', 
      [parseFloat(updatedRating.toFixed(1)), ratingCount + 1, sellerId], (err) => {
      if (err) {
        console.error('Error updating rating:', err);
        return res.json({ success: false });
      }
      res.json({ success: true });
    });
  });
});

app.get('/add-meal', isAuthenticatedSeller, (req, res) => {
  const sellerName = req.session.sellerName; 
  res.render('seller/sellerHome', { sellerName, message: '' });
});

app.post('/add-meal', isAuthenticatedSeller, upload.single('meal_image'), (req, res) => {
  const { name, price, contents, prep_time } = req.body;
  const sellerId = req.session.sellerId;
  const sellerName = req.session.sellerName;

  const mealImage = req.file ? `/uploads/` +req.file.filename : null;

  if (!mealImage) {
    return res.render('seller/sellerHome', { sellerName, message: 'Meal image is required.' });
  }

  db.query('INSERT INTO meals (seller_id, seller_name, name, price, contents, prep_time, image_url) VALUES ($1, $2, $3, $4, $5, $6, $7)', 
    [sellerId, sellerName, name, price, contents, prep_time, mealImage], (err) => {
    if (err) {
      console.error('Error adding meal:', err);
      return res.render('seller/sellerHome', { message: 'Error adding meal. Please try again.', sellerName });
    }
    res.render('seller/sellerHome', { message: 'Meal added successfully', sellerName });
  });
});

app.get('/view-meals', isAuthenticatedSeller, (req, res) => {
  const sellerId = req.session.sellerId;
  const sellerName = req.session.sellerName;
  db.query('SELECT * FROM meals WHERE seller_id = $1', [sellerId], (err, result) => {
    if (err) {
      console.error('Error fetching meals:', err);
      return res.redirect('/seller/sellerHome');
    }
    res.render('seller/viewMeals', { meals: result.rows, sellerName });
  });
});

app.get('/update-meal/:id', isAuthenticatedSeller, (req, res) => {
  const { id } = req.params;
  const sellerName = req.session.sellerName;
  db.query('SELECT * FROM meals WHERE id = $1', [id], (err, result) => {
    if (err) {
      console.error('Error fetching meal for update:', err);
      return res.redirect('/view-meals');
    }
    if (result.rows.length > 0) {
      res.render('seller/updateMeal',{ meal: result.rows[0], sellerName });
    } else {
      res.redirect('/view-meals'); 
    }
  });
});

app.post('/update-meal', isAuthenticatedSeller, upload.single('meal_image'), (req, res) => {
  const { id, name, price, contents, prep_time } = req.body;
  let mealImage = req.file ? `/uploads/` +req.file.filename : null ; 
  const getMealQuery = 'SELECT image_url FROM meals WHERE id = $1';
  db.query(getMealQuery, [id], (err, result) => {
    if (err) {
      console.error('Error fetching meal:', err);
      return res.render('seller/updateMeal', { message: 'Error fetching meal. Please try again.', meal: { id, name, price, contents, prep_time }, sellerName });
    }

    const oldImageUrl = result.rows.length > 0 ? result.rows[0].image_url : null;
    
    mealImage = mealImage || oldImageUrl;

    const updateMealQuery = 'UPDATE meals SET name = $1, price = $2, contents = $3, prep_time = $4, image_url = $5 WHERE id = $6';
    db.query(updateMealQuery, [name, price, contents, prep_time, mealImage, id], (err) => {
      if (err) {
        console.error('Error updating meal:', err);
        return res.render('seller/updateMeal', { message: 'Error updating meal. Please try again.', meal: { id, name, price, contents, prep_time }, sellerName });
      }
      res.redirect('/view-meals');
    });
  });
});

app.post('/delete-meal/:id', isAuthenticatedSeller, (req, res) => {
  const { id } = req.params;
  const sellerName = req.session.sellerName; 
  db.query('DELETE FROM meals WHERE id = $1', [id], (err) => {
    if (err) {
      console.error('Error deleting meal:', err);
      return res.render('seller/deleteMeal', { message: 'Error deleting meal. Please try again.', meal: { id } ,sellerName});
    }
    res.redirect('/view-meals');
  });
});

app.get('/view-seller-meals/:id', (req, res) => {
  const sellerId = req.params.id;
  const customerName = req.session.customerName;
  const cartCount = req.session.cart ? req.session.cart.length : 0;

  db.query('SELECT * FROM meals WHERE seller_id = $1 AND is_enabled = true', [sellerId], (err, result) => {
    if (err) {
      console.error('Error fetching meals:', err);
      return res.render('customer/viewAllSellers', { message: 'Error fetching meals. Please try again.', customerName });
    }

    db.query('SELECT * FROM sellers WHERE id = $1', [sellerId], (err, sellerResult) => {
      if (err) {
        console.error('Error fetching seller:', err);
        return res.render('customer/viewAllSellers', { message: 'Error fetching seller. Please try again.', customerName });
      }

      const seller = sellerResult.rows[0];
      res.render('customer/viewSellerMeals', { meals: result.rows, seller, customerName, cartCount });
    });
  });
});

app.post('/toggle-meal-status/:id', (req, res) => {
  const mealId = req.params.id;

  db.query('SELECT is_enabled FROM meals WHERE id = $1', [mealId], (err, result) => {
    if (err || result.rows.length === 0) {
      console.error('Error fetching meal:', err);
      return res.redirect('/seller/home'); 
    }

    const currentStatus = result.rows[0].is_enabled;
    const newStatus = !currentStatus; 

    db.query('UPDATE meals SET is_enabled = $1 WHERE id = $2', [newStatus, mealId], (err) => {
      if (err) {
        console.error('Error updating meal status:', err);
        return res.redirect('/seller/home');
      }
      res.redirect('/view-meals'); 
    });
  });
});

app.get('/cart', isAuthenticatedCustomer, (req, res) => {
  const customerName = req.session.customerName;
  const cartItems = req.session.cart ? req.session.cart : [];
  const cartCount = cartItems.length;

  res.render('customer/cart', { customerName, cartItems, cartCount });
});

app.post('/cart/add', (req, res) => {
  const mealId = req.body.mealId;
  const mealName = req.body.mealName;
  const mealPrice= req.body.mealPrice;
  const mealContents = req.body.mealContents;
  const mealPrep=req.body.mealPrep;
  const mealSeller=req.body.mealSeller;
  const mealImage=req.body.mealImage;
  if (!req.session.cart) {
    req.session.cart = [];
  }
  req.session.cart.push({ id: mealId, name: mealName, price: mealPrice, contents: mealContents, prep_time: mealPrep, seller_name:mealSeller, image_url: mealImage });
  res.json({ cartCount: req.session.cart.length });
});

app.post('/add-to-cart/:mealId', isAuthenticatedCustomer, (req, res) => {
  const mealId = req.params.mealId;

  db.query('SELECT * FROM meals WHERE id = $1', [mealId], (err, result) => {
    if (err || result.rows.length === 0) {
      return res.redirect('/view-seller-meals/' + req.session.sellerId);
    }
    const meal = result.rows[0];
    if (!req.session.cart) {
      req.session.cart = [];
    }
    if (!req.session.cart.some(item => item.id === meal.id)) {
      req.session.cart.push({
        id: meal.id,
        name: meal.name,
        price: meal.price,
        contents: meal.contents,
        prep_time: meal.prep_time,
        seller_name: meal.seller_name,
        image_url: meal.image_url 
      });
    }

    res.redirect('/cart');
  });
});

app.post('/remove-from-cart/:id', (req, res) => {
  const mealId = req.params.id;
  if (req.session.cart) {
    req.session.cart = req.session.cart.filter(item => item.id !== mealId);
  }
  res.redirect('/cart');
});

app.get('/order/:mealId', isAuthenticatedCustomer, (req, res) => {
  const mealId = req.params.mealId;
  const customerId = req.session.customerId; 

  db.query('SELECT * FROM meals WHERE id = $1', [mealId], (err, mealResult) => {
    if (err || mealResult.rows.length === 0) {
      console.error('Error fetching meal:', err);
      return res.redirect('/customer/home');
    }

    db.query('SELECT address FROM customers WHERE id = $1', [customerId], (err, customerResult) => {
      if (err || customerResult.rows.length === 0) {
        console.error('Error fetching customer address:', err);
        return res.redirect('/customer/home');
      }

      const meal = mealResult.rows[0]; 
      const customerLocation = customerResult.rows[0].address || 'Not specified'; 

      res.render('customer/ordernow', {
        customerName: req.session.customerName,
        meal: meal, 
        customerLocation: customerLocation,
        cartCount: req.session.cart ? req.session.cart.length : 0
      });
    });
  });
});

app.post('/checkout', isAuthenticatedCustomer, (req, res) => {
  const customerId = req.session.customerId;  
  const customerName = req.session.customerName;
  const cartItems = req.session.cart ? req.session.cart : [];

  if (cartItems.length === 0) {
    return res.redirect('/cart');
  }

  db.query('SELECT address FROM customers WHERE id = $1', [customerId], (err, result) => {
    if (err) {
      console.error('Error fetching customer address:', err);
      return res.redirect('/cart');
    }

    const customerLocation = result.rows[0].address || 'Not specified';

    res.render('customer/orderCart', {
      cartItems,
      customerName,
      customerLocation 
    });
  });
});


app.get('/payment-confirmation', (req, res) => {
 // const cartCount=0;
 // const cartItems=[];
  const customerName = req.session.customerName;
  res.render('customer/payment-confirmation', { customerName:customerName });//,cartCount:cartCount });
});

app.post('/create-order', async (req, res) => {
  const { amount } = req.body;
  try {
    const order = await razorpay.orders.create({
      amount: amount,
      currency: "INR",
      payment_capture: 1
    });
    res.json({
      id: order.id,
      amount: order.amount
    });
  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/customer/orders', (req, res) => {
   const customerName = req.session.customerName;
   res.render('customer/orders', { customerName:customerName });
});

app.get('/get-branch-name/:ifsc', async (req, res) => {
  const IFSC = req.params.ifsc;

  try {
    const response = await axios.get(`https://ifsc.razorpay.com/${IFSC}`);
    
    if (response.data && response.data.BRANCH) {
      res.json({ branch: response.data.BRANCH });
    } else {
      console.error('Branch not found for IFSC:', IFSC);
      res.json({ branch: null });
    }
  } catch (error) {
    console.error('Error fetching IFSC details:', error.message);  
    res.json({ branch: null });
  }
});

app.post('/logout/seller', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      console.error('Error during seller logout:', err);
      return res.redirect('/seller/home');
    }
    res.redirect('/seller/login'); 
  });
});

app.post('/logout/customer', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      console.error('Error during customer logout:', err);
      return res.redirect('/customer/home');
    }
    res.redirect('/customer/login'); 
  });
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
}); 