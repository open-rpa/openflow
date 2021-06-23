// const path = require("path");
// const env = path.join(process.cwd(), 'config', '.env');
// console.log(env);
// require("dotenv").config({ path: env }); // , debug: false 

// import { SelectCustomerMessage } from "@openiap/openflow-api";
// import assert = require("assert");
// import { Crypt } from "../Crypt";
// import { Message } from "./Message";

// // var assert = require('assert');
// describe('Array', function () {
//     describe('#indexOf()', function () {
//         it('should return -1 when the value is not present', function () {
//             assert.strictEqual([1, 2, 3].indexOf(4), -1);
//         });
//     });
// });


// describe('Select Customer', () => {
//     it('Unselect', async () => {
//         var q = new SelectCustomerMessage();
//         var msg = new Message(); msg.jwt = Crypt.rootToken();
//         await msg.SelectCustomer(null);
//         q = JSON.parse(msg.data);
//         assert.ok(q && !q.error, q.error);
//     })
//     it('Select main customer', async () => {
//         var q = new SelectCustomerMessage(); q.customerid = "60b683e12382b05d20762f09";
//         var msg = new Message(); msg.jwt = Crypt.rootToken();
//         msg.data = JSON.stringify(q);
//         await msg.SelectCustomer(null);
//         q = JSON.parse(msg.data);
//         assert.ok(q && !q.error, q.error);
//     })
// })
