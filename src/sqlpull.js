'use strict';
module.exports.sqlpull = sqlpull;
/**
 * Init Schedule by pushConfig.schemaSWXPush
 */
const pullConfig = require('../config/sql_pull.json');
const NodePackage = require('../service/nodepackage.service').NodePackage;

const bunyan = NodePackage.bunyan;
const kafka = NodePackage.kafkanode;
const constants = require('../utils/constant.json');
const Sequelize = NodePackage.Sequelize;
const moment = NodePackage.moment;
const _ = NodePackage._;

function sqlpull(config, utility) {
  const log = bunyan.createLogger({ name: 'SqlPush', level: config.logger.loglevel });

  return {
    init() {
      // Validate sql_push.json
      utility.validateSqlPullConfigParameters(pullConfig);
      const {
        schemaSWXPull: connectionDetails,
        dbConnectors,
      } = pullConfig;
      connectionDetails.forEach((detail) => {
        // Validate Connector
        const isConnectorValid = this.validateConnector(detail, dbConnectors);
        if (isConnectorValid) {
          // Generate Schema
          this.validateSchema(detail.schema , detail.elementName);
          const connectionDetail = {
            detail,
            connector: dbConnectors.filter((connector) => {
              return connector.dbConnectorName === detail.dbConnectorName
            })[0]
          };
          this.run(connectionDetail);
        } else {
          log.error(`No Valid Connector for Push Schema: ${detail.elementName}`);
          process.exit(1);
        }
      });
    },
    validateConnector(detail, connectors) {
      const ifExists = connectors.filter((connector) => {
        return connector.dbConnectorName === detail.dbConnectorName
      }).length > 0;
      return ifExists;
    },
    /**
     * Validate keys Schema from configured Json file
     */
    validateSchema(configuredSchema, elementName) {
      /**
       * consider below example for schema to be validated.
       * {
      "id": {
        "type": "integer",
        "primaryKey": true,
        "autoIncrement": true
      },
      "machine_name": {
        "type": "string",
        "allowNull": false
      }
    }
       */
      let parentkeys = Object.keys(configuredSchema);
      // parentKeys = ['id', 'machine_names']
      parentkeys.forEach((key) => {
        let jsonObj = configuredSchema[key];
        let childKeys = Object.keys(jsonObj);
        // example childKey = ['type', 'primaryKeys','autoIncrement']
        // throw error that no child keys identified.
        childKeys.forEach((childKey) => {
          if (!_.includes(constants.SEQUELIZE_KEYS, childKey)) {
            // for example childkey = 'somethingWrong'
            /**
             * example:
             * 09:48:01.604Z ERROR sql-connector: Unidentified child key: primaryKey1, parent key: id, Element Name: planningtest, Kindly verify and make changes in configurations.
             * 09:48:01.605Z ERROR sql-connector: Allowed child Keys: type,primaryKey,autoIncrement,allowNull
             */
            utility.drawLine();
            log.error('Unidentified child key: ' + childKey + ', parent key: ' + key + ', Element Name: ' + elementName + ', Kindly verify and make changes in configurations.');
            log.error('Allowed child Keys: ' + constants.SEQUELIZE_KEYS);
            utility.drawLine();
            process.exit(1);
          }
          // if (constants.SEQUELIZE_KEYS_TYPE === childKey) {
          //   // special case to check if type is date then, whether it contains a 'format' expected
          //   // if format is mentioned in the schema along iwth type as date, then we need to assign a
          //   // function inside to convert the obtained date from DB to our format in the payload.
          //   if (jsonObj[childKey] === constants.SEQUELIZE_DATATYPE.DATE) {
          //     if (childKeys.includes(constants.SEQUELIZE_KEYS_DATE_FORMAT)) {
          //       // since the date format exists, we will obtained date to our given format using moment js
          //       let dateFormat = jsonObj[constants.SEQUELIZE_KEYS_DATE_FORMAT];
          //       jsonObj[constants.SEQUELIZE_KEYS_GET] = function () {
          //         let isUTC = (childKeys.includes(constants.SEQUELIZE_KEYS_UTC) && jsonObj[constants.SEQUELIZE_KEYS_UTC]);
          //         // this always returns a valid date. In absence of values it uses current date.
          //         return utility.getValidDate(isUTC, this.getDataValue(key), dateFormat, key);
          //       }
          //     }
          //   }
          //   // Get appropriate type associated with the
          //   jsonObj[childKey] = this.getDataType(jsonObj[childKey]);
          // }
          if (!(typeof jsonObj[childKey] === constants.SEQUELIZE_KEYS_DATATYPE[childKey])) {
            /**
             * example:
             * 09:16:50.977Z ERROR sql-connector: Expected Datatype: function, Actual Datatype: undefined, child key: type, parent key: id, Element Name: planningtest
             * 09:16:50.977Z ERROR sql-connector: Kindly verify and make changes in configurations. Allowed data types child Keys: {"type":"function","primaryKey":"boolean","autoIncrement":"boolean","allowNull":"boolean"}
             */
            utility.drawLine();
            log.error('Expected Datatype: ' + constants.SEQUELIZE_KEYS_DATATYPE[childKey] + ', Actual Datatype: ' + typeof jsonObj[childKey] +
              ', child key: ' + childKey + ', parent key: ' + key + ', Element Name: ' + elementName);
            log.error('Kindly verify and make changes in configurations. Allowed data types child Keys: ' + JSON.stringify(constants.SEQUELIZE_KEYS_DATATYPE));
            utility.drawLine();
            process.exit(1);
          }
        });
      });
      log.error('Schema succesfully validated for Element Name/ Table name: ' + elementName);
      // console.error('Validated Schema : ', configuredSchema);
      log.error('Validated Schema [type will not appear as it is a sequelize datatype function]: ' + JSON.stringify(configuredSchema));
    },
    run(connectionDetail) {
      // Init Connector
      // Init Table
      // Init Kafka Consumer
      this.initConnector(connectionDetail);
    },
    initConnector(connectionDetail) {
      const { connector, detail } = connectionDetail;
      log.info('Init Connector');
      const sequelizeObj = new Sequelize(connector.props.database,
        connector.props.username,
        connector.props.password, {
        host: connector.props.hostname,
        dialect: connector.props.dialect,
        port: connector.props.port,
        connectionTimeout: connector.props.connectionTimeout,
        requestTimeout: connector.props.requestTimeout,
        pool: {
          idleTimeoutMillis: connector.props.pool.idleTimeoutMillis,
          max: connector.props.pool.max
        }
      });
      sequelizeObj.authenticate().then(() => {
        log.error('Successfully Authenticated to Database server: ' + connector.props.dialect);
        const sequelizeTable = sequelizeObj.define(detail.tableName, detail.schema, {
          timestamps: false,
          freezeTableName: true,
        });
        this.initKafka(detail, sequelizeTable);
      }, (error) => {
        log.error(error.message);
        process.exit(1);
      });
    },
    initKafka(detail, sequelizeTable) {
      const { kafka: kafkaConfigEdge } = detail
      try {
        log.info('initializing Edge kafka connection');
        const client = new kafka.KafkaClient({ kafkaHost: `${kafkaConfigEdge.host}:${kafkaConfigEdge.port}` });
        let offset = new kafka.Offset(client);
        let latest = 1;
        let consumerGroup = null;
        offset.fetchLatestOffsets([kafkaConfigEdge.topic_name], (err, offsets) => {
          if (err) {
            log.error(`error fetching latest offsets from kafka topic`);
            log.error(`${err}`);
            return;
          }
          Object.keys(offsets[kafkaConfigEdge.topic_name]).forEach(o => {
            latest = offsets[kafkaConfigEdge.topic_name][o] > latest ? offsets[kafkaConfigEdge.topic_name][o] : latest
          })
        });
        consumerGroup = new kafka.ConsumerGroup(
          {
            kafkaHost: `${kafkaConfigEdge.host}:${kafkaConfigEdge.port}`,
            groupId: kafkaConfigEdge.topic_name,
            sessionTimeout: 15000,
            protocol: ["roundrobin"],
            encoding: 'utf8',
            fromOffset: kafkaConfigEdge.fromOffset,
            outOfRangeOffset: kafkaConfigEdge.outOfRangeOffset,
            autoCommit: kafkaConfigEdge.autoCommit,
            autoCommitIntervalMs: kafkaConfigEdge.autoCommitIntervalMs,
            heartbeatInterval: 100,
            maxTickMessages: 1,
          },
          kafkaConfigEdge.topic_name
        );
        consumerGroup.on("connect", () => {
          log.info("kafka consumerGroup connect");
        });
        consumerGroup.on('offsetOutOfRange', (err) => {
          log.error(`offsetOutOfRange ${err}`);
          consumerGroup.close(true, (err, res) => {
            if (!err) {
              log.error(`kafka event consumer connection closed successfully ${res}`);
            } else {
              log.error(`Error in closing kafka event consumer ${err}`);
            }
            this.initKafka(detail, sequelizeTable);
          })
        })
        consumerGroup.on("error", (error) => {
          log.error(`Error in kafka consumer: ${error}`);
          consumerGroup.close(true, (err, res) => {
            if (!err) {
              log.error(`kafka event consumer connection closed successfully ${res}`);
            } else {
              log.error(`Error in closing kafka event consumer ${err}`);
            }
            this.initKafka(detail, sequelizeTable);
          })
        });
        consumerGroup.on(`message`, async (message) => {
          const payload = JSON.parse(message.value);
          delete payload.ignore;
          // log.info(message.offset + " = " + latest);
          // wait for consuming messages till latestone
          if (config.defaults.isPreviousDataIgnored) {
            if (message.offset >= latest - 1) {
              this.processTransfer(payload, sequelizeTable, detail);
            }
          } else {
            this.processTransfer(payload, sequelizeTable, detail);
          }
        });
      } catch (ex) {
        log.error(`Exception in initKafka ${ex}`);
        this.initKafka(detail, sequelizeTable);
      }
    },
    getMappedPayload(connectorDetails, records) {
      let recordLength = records.length;
      let JSONArray = [];
      let mappings = JSON.parse(JSON.stringify(connectorDetails.mappings));
      let documentFields = Object.keys(mappings);

      // let tableColumnNames = _.map(arr, o => _.pick(o, documentFields));
      for (let j = 0; j < recordLength; j++) {
        let jsonObj = {};
        let record = records[j];
        for (let i = 0; i < documentFields.length; i++) {
          let key = documentFields[i];
          let detail = mappings[documentFields[i]];
          // if there are any keys that must be excluded from the

          // create a key : value in the payload.
          let value = record[detail.field];
          if (value) {
            if (detail.transformDate) {
              if (detail.timestamp) {
                jsonObj[key] = moment(value).valueOf();
              } else {
                jsonObj[key] = moment(value).format(detail.dateFormat);
              }
            } else {
              jsonObj[key] = value;
            }
          } else {
            const value = 'N.A';
            log.info('Setting default value for key: ' + key + ", value:  " + value);
            jsonObj[key] = value;
          }
        }
        if (jsonObj && Object.keys(jsonObj).length) {
          // adding a timestamp field since we get shifts related data in MongoDB end as well.
          JSONArray.push(jsonObj);
        } else {
          log.error("No Json object created with record: " + JSON.stringify(records[j]));
        }
      }
      log.trace("ElementName: " + connectorDetails.elementName + ", Final Payload: " + JSON.stringify(JSONArray));
      return JSONArray;
    },
    async processTransfer(payload, sequelizeTable, detail) {
      log.info(`Get Kafka Message: ${JSON.stringify(payload)}`);
      let isrightmessage = true;
      if (detail.conditions.length) {
        isrightmessage = this.validateConditions(payload, detail.conditions);
      }
      if (!isrightmessage) {
        log.info(`No Right Message`);
        return;
      }
      payload = this.getMappedPayload(detail, [payload]);
      try {
        const response = await sequelizeTable.create(payload[0]);
        if (response instanceof sequelizeTable) {
          log.error('Success Calling Sequelize Create : ' + response);
        } else {
          log.error('Error caught while calling Sequelize Create  API');
          this.processTransfer(payload, sequelizeTable, detail);
        }
      } catch (err) {
        log.error('Error caught while calling Sequelize Create  API: ' + (err.message ? err.message : err));
      }
    },
    validateConditions(data, conditions) {
      const valideResult = conditions.map((item) => {
        const { field, type, value } = item;
        if (type == '=') {
          return data[field] == value;
        } else if (type == '>') {
          return data[field] > value;
        } else if (type == '<') {
          return data[field] < value;
        } else if (type == '<=') {
          return data[field] <= value;
        } else if (type == '>=') {
          return data[field] >= value;
        } else if (type == '<>') {
          return data[field] != value;
        } else {
          return false;
        }
      });
      return valideResult.filter(item => !item).length == 0
    },
  };
}
