'use strict';
module.exports.sqlpush = sqlpush;
/**
 * Init Schedule by pushConfig.schemaSWXPush
 */
const pushConfig = require('../config/sql_push.json');
const NodePackage = require('../service/nodepackage.service').NodePackage;

const bunyan = NodePackage.bunyan;
const Bree = NodePackage.bree;
const Sequelize = NodePackage.Sequelize;
const path = NodePackage.path;
// const fs = NodePackage.fs;
const _ = NodePackage._;
const outputDirectory = '/home/emgda/shopworx/schedule/output/';
const constants = require('../utils/constant.json');
function sqlpush(config, utility, tags) {
  const log = bunyan.createLogger({ name: 'SqlPush', level: config.logger.loglevel });

  return {
    pushList: {},
    getElementName() {
      return
    },
    init() {
      // Validate sql_push.json
      utility.validateSqlPushConfigParameters(pushConfig);
      const {
        schemaSWXPush: connectionDetails,
        dbConnectors,
      } = pushConfig;
      connectionDetails.forEach((detail) => {
        // Validate Connector
        const isConnectorValid = this.validateConnector(detail, dbConnectors);
        if (isConnectorValid) {
          // Generate Schema
          this.validateSchema(detail.schema, detail.elementName);
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
    run(connectionDetail) {
      const dir = `${outputDirectory}${connectionDetail.detail.elementName}.txt`;
      connectionDetail.dir = dir;
      this.implSchedule(connectionDetail);
    },
    implSchedule(data) {
      const job = new Bree({
        root: path.resolve('/home/emgda/shopworx/schedule/jobs'),
        // root: path.resolve('./jobs'),
        jobs: [{
          name: 'sql_push',
          worker: {
            workerData: {
              connectionDetail: data,
              config: config,
              tags: tags,
            }
          },
          cron: data.detail.cron,
        }],
        hasSeconds: true,
        cronValidate: {
          override: { useAliases: true }
        }
      });
      job.start();
      this.pushList[data.tableName] = job;
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
          if (constants.SEQUELIZE_KEYS_TYPE === childKey) {
            // special case to check if type is date then, whether it contains a 'format' expected
            // if format is mentioned in the schema along iwth type as date, then we need to assign a
            // function inside to convert the obtained date from DB to our format in the payload.
            // if (jsonObj[childKey] === constants.SEQUELIZE_DATATYPE.DATE) {
            //   if (childKeys.includes(constants.SEQUELIZE_KEYS_DATE_FORMAT)) {
            //     // since the date format exists, we will obtained date to our given format using moment js
            //     let dateFormat = jsonObj[constants.SEQUELIZE_KEYS_DATE_FORMAT];
            //     jsonObj[constants.SEQUELIZE_KEYS_GET] = function () {
            //       let isUTC = (childKeys.includes(constants.SEQUELIZE_KEYS_UTC) && jsonObj[constants.SEQUELIZE_KEYS_UTC]);
            //       // this always returns a valid date. In absence of values it uses current date.
            //       return utility.getValidDate(isUTC, this.getDataValue(key), dateFormat, key);
            //     }
            //   }
            // }
            // Get appropriate type associated with the 
            // jsonObj[childKey] = this.getDataType(jsonObj[childKey]);
          }

        });
      });
      log.error('Schema succesfully validated for Element Name/ Table name: ' + elementName);
      // console.error('Validated Schema : ', configuredSchema);
      log.error('Validated Schema [type will not appear as it is a sequelize datatype function]: ' + JSON.stringify(configuredSchema));
    },
    /**
    * Get the data type based out of configured type in configuration file.
    */
    getDataType(type, param) {
      switch (type) {
        case constants.SEQUELIZE_DATATYPE.STRING:
          if (typeof param === 'number') {
            return Sequelize.STRING(param);
          }
          return Sequelize.STRING;

        case constants.SEQUELIZE_DATATYPE.TEXT:
          return Sequelize.TEXT;

        case constants.SEQUELIZE_DATATYPE.TINY_TEXT:
          return Sequelize.TEXT('tiny');

        case constants.SEQUELIZE_DATATYPE.TEXT_ARRAY:
          return Sequelize.ARRAY(Sequelize.TEXT);

        case constants.SEQUELIZE_DATATYPE.CITEXT:
          return Sequelize.CITEXT;

        case constants.SEQUELIZE_DATATYPE.INTEGER:
          return Sequelize.INTEGER;

        case constants.SEQUELIZE_DATATYPE.BIGINT:
          if (typeof param === 'number') {
            return Sequelize.BIGINT(param);
          }
          return Sequelize.BIGINT;

        case constants.SEQUELIZE_DATATYPE.DOUBLE:
          if (typeof param === 'number') {
            return Sequelize.DOUBLE(param);
          }
          return Sequelize.DOUBLE;

        case constants.SEQUELIZE_DATATYPE.FLOAT:
          if (typeof param === 'number') {
            return Sequelize.FLOAT(param);
          }
          return Sequelize.FLOAT;

        case constants.SEQUELIZE_DATATYPE.REAL:
          if (typeof param === 'number') {
            return Sequelize.REAL(param);
          }
          return Sequelize.REAL;

        case constants.SEQUELIZE_DATATYPE.DECIMAL:
          return Sequelize.DECIMAL;

        case constants.SEQUELIZE_DATATYPE.DATE:
          if (typeof param === 'number') {
            return Sequelize.DATE(param);
          }
          return Sequelize.DATE;

        case constants.SEQUELIZE_DATATYPE.BOOLEAN:
          return Sequelize.BOOLEAN;

        case constants.SEQUELIZE_DATATYPE.JSON_TYPE:
          return Sequelize.JSON;

        case constants.SEQUELIZE_DATATYPE.JSONB:
          return Sequelize.JSONB;

        case constants.SEQUELIZE_DATATYPE.INTEGER_RANGE:
          return Sequelize.RANGE(Sequelize.INTEGER);

        case constants.SEQUELIZE_DATATYPE.BIGINT_RANGE:
          return Sequelize.RANGE(Sequelize.BIGINT);

        case constants.SEQUELIZE_DATATYPE.DATE_RANGE:
          return Sequelize.RANGE(Sequelize.DATE);

        case constants.SEQUELIZE_DATATYPE.DATEONLY_RANGE:
          return Sequelize.RANGE(Sequelize.DATEONLY);

        case constants.SEQUELIZE_DATATYPE.DECIMAL_RANGE:
          return Sequelize.RANGE(Sequelize.DECIMAL);
      }
    }

  };

}
