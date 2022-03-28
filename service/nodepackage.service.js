const bunyan = require('bunyan');
const axios = require('axios');
const qs = require('querystring');
const EventEmitter = require('events');
const socket = require('socket.io-client');
const datefns = require('date-fns');
const _ = require('lodash');
const bree = require('bree');
const Email = require('email-templates');
const pug = require('pug');
const path = require('path');
const kafkanode = require('kafka-node');
const Sequelize = require('sequelize');
const fs = require('fs');
const moment = require('moment');

class NodePackage {
  constructor() {
    this._ = _;
    this.pug = pug;
    this.Email = Email;
    this.bree = bree;
    this.bunyan = bunyan;
    this.axios = axios;
    this.qs = qs;
    this.EventEmitter = EventEmitter;
    this.socket = socket;
    this.datefns = datefns;
    this.path = path;
    this.fs = fs;
    this.kafkanode = kafkanode;
    this.Sequelize = Sequelize;
    this.moment = moment;
  }
}
module.exports.NodePackage = new NodePackage();
