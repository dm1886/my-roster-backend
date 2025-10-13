console.log('Testing nodemailer...');
const nodemailer = require('nodemailer');

console.log('Type of nodemailer:', typeof nodemailer);
console.log('Nodemailer keys:', Object.keys(nodemailer));
console.log('Has createTransporter?', typeof nodemailer.createTransporter);

if (nodemailer.createTransporter) {
  console.log('✅ createTransporter exists!');
} else {
  console.log('❌ createTransporter NOT found');
  console.log('Full nodemailer object:', nodemailer);
}