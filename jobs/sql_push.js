/**
 * Basic
 * Init Auth
 */
 const Worker = require("bthreads");
 const basic = require("./basic");
 const nodePackage = require("../service/nodepackage.service");
 const EventEmitter = require("events");

 let emitter = new EventEmitter.EventEmitter();
 const { HTTP_STATUS_CODE, setTimer, ApiService } = basic;
 const { workerData } = Worker;
 const { connectionDetail, config } = workerData;
 const { dir, connector, detail } = connectionDetail;
 const NodePackage = nodePackage.NodePackage;

 const bunyan = NodePackage.bunyan;
 const Sequelize = NodePackage.Sequelize;
 const moment = NodePackage.moment;
 const fs = NodePackage.fs;
 const server = config.server;
 const credential = config.credential;
 const retryServer = config.defaults.retry || 10;
 const requestTimeout = config.defaults.requesttimeout || 40;
 let onStartup = false;
 const log = bunyan.createLogger({
   name: `Sql Push for ${detail.elementName}`,
   level: config.logger.loglevel,
 });

 // Init Shopworx ApiService
 const apiService = new ApiService(server);
 apiService.setTimeout(requestTimeout);
 // set loginType in axios header
 apiService.setDefaultHeader(config.loginType);

 // Auth Payload
 const login_payload = {
   identifier: credential.identifier,
   password: credential.password,
 };

 const { defaultMappings } = detail;
 // Element Api
 const ElementService = {
   createElementRecord(elementName, data) {
     return apiService.post(`/server/elements/${elementName}/records`, data);
   },
   updateElementRecordsByQuery(elementName, data, query) {
     let url = `/server/elements/${elementName}/records`;
     if (query) {
       url += `?${query}`;
     }
     return apiService.put(url, data);
   },
   updateElementRecordById(elementName, data, id) {
     return apiService.put(
       `/server/elements/${elementName}/records/${id}`,
       data
     );
   },
   createElementMultipleRecords(elementName, data) {
     return apiService.post(
       `/server/elements/${elementName}/createbulkrecords`,
       data
     );
   },
   getElementRecords(elementName, query) {
     let url = `/server/elements/${elementName}/records`;
     if (query) {
       url += `?${query}`;
     }
     return apiService.get(`${url}`);
   },
 };

 const checkSessionExpired = (data) => {
   if (data && data.errors && data.errors.errorCode === "INVALID_SESSION") {
     log.error(`Session Id expired ${JSON.stringify(data.errors)}`);
     emitter.emit("sessionExpired");
   }
 };

 async function getAuthentication(login_payload) {
   const response = await apiService.post("/server/authenticate", login_payload);
   const { status, data } = response;
   if (status === HTTP_STATUS_CODE.SUCCESS && data) {
     apiService.setHeader(data.sessionId);
     if (!onStartup) {
       onStartup = true;
       emitter.emit("init");
     }
   } else {
     // retry for authentication
     log.error(
       `Error in authentication to server ${JSON.stringify(response.data)}`
     );
     await setTimer(retryServer);
     await this.getAuthentication();
   }
 }

 emitter.on("sessionExpired", () => {
   log.info(`Session Expired trying to reAuthenticate`);
   getAuthentication();
 });
 emitter.on("init", () => {
   log.error(dir);
   log.error(fs.existsSync(dir));
   log.error(`Authentication done successfully`);
   try {
     readUpdateRow();
   } catch (ex) {
     log.error(ex);
   }
 });

 getAuthentication(login_payload);

 /**
  * SQL Push Logic
  * Step 1. Implement Connector
  * Step 2. Generate Schema
  * Step 3. Run Query
  */
 let sequelizeObj, sequelizeTable;
 const limit = detail.limit;
 let skip = 0;

 function readUpdateRow() {
   if (fs.existsSync(dir)) {
     fs.readFile(dir, (err, data) => {
       if (err) {
         log.error("Error occured while First reading " + dir + ": " + err);
         process.exit(1);
       } else {
         let updateRow = parseInt(data, 10);
         if (typeof updateRow === "number" || !isNaN(updateRow)) {
           skip = updateRow;
           initConnector();
         } else {
           log.fatal("No Number identified in file: " + dir);
           process.exit(1);
         }
       }
     });
   } else {
     fs.writeFile(dir, "0", "utf8", (err) => {
       if (err) {
         log.error("Error occured while First reading " + dir + ": " + err);
         process.exit(1);
       } else {
         log.error("File created: " + this.file);
         skip = 0;
         initConnector();
       }
     });
   }
 }

 function initConnector() {
   log.info("Init Connector");
   sequelizeObj = new Sequelize(
     connector.props.database,
     connector.props.username,
     connector.props.password,
     {
       host: connector.props.hostname,
       dialect: connector.props.dialect,
       port: connector.props.port,
       connectionTimeout: connector.props.connectionTimeout,
       requestTimeout: connector.props.requestTimeout,
       pool: {
         idleTimeoutMillis: connector.props.pool.idleTimeoutMillis,
         max: connector.props.pool.max,
       },
     }
   );
   sequelizeObj.authenticate().then(
     () => {
       log.info(
         "Successfully Authenticated to Database server: " +
           connector.props.dialect
       );
       sequelizeTable = sequelizeObj.define(detail.tableName, detail.schema, {
         timestamps: false,
         freezeTableName: true,
       });
       initiateDataTransfer();
     },
     (error) => {
       log.error(error.message);
       process.exit(1);
     }
   );
 }

 function initiateDataTransfer() {
   let primaryKey = sequelizeTable.primaryKeyAttributes[0];
   if (primaryKey) {
     const primary = detail.schema[primaryKey];
     log.info("Primary Key Status: Present.");
     // follow skipping last N Ids to avoid glitch
     sequelizeTable.max(primaryKey).then((count) => {
       log.info("Max(" + primaryKey + "): " + count);
       let lagLimit = detail.lagLimit;
       let range;
       if (primary.type == "date") {
         range = moment(count).add(1, "m").format();
       } else {
         range = count - lagLimit;
         log.info("Max range = " + count + " - " + lagLimit + " = " + range);
         log.info("Max range: " + range);
       }
       let subCondition = {};
       subCondition[primaryKey] = {
         [Sequelize.Op.lt]: range,
       };
       let conditions = {
         offset: skip,
         limit: limit,
         where: {
           [Sequelize.Op.and]: subCondition,
         },
       };
       processTansfer(conditions);
     });
   } else {
     log.info("Primary Key Status: Absent.");
     let conditions = {
       offset: skip,
       limit: limit,
     };
     processTansfer(conditions);
   }
 }

 async function processTansfer(queryConditions) {
   log.info(
     "QUERY | ElementName: " +
       detail.elementName +
       ", Query Params: " +
       JSON.stringify(queryConditions)
   );
   const fetchRecords = await sequelizeTable.findAll(queryConditions);
   if (fetchRecords && fetchRecords.length) {
     // proceed when fetchRecords are present
     if (detail.isInsertOnLimitMatch && limit !== fetchRecords.length) {
       log.error(
         "Skipping Data write for ElementName: " +
           detail.elementName +
           " fetchRecords Fetched: " +
           fetchRecords.length +
           ", Limit: " +
           limit
       );
       process.exit(1);
     }
     log.error(
       fetchRecords.length + " Record/s Fetched: " + JSON.stringify(fetchRecords)
     );
     let mappedPayload = await getMappedPayload(detail, fetchRecords);
     let connectorDetails = detail;
     //fetch the udpated row from all the fetchRecords.
     let updatedRowCount = skip + fetchRecords.length;
     if (typeof updatedRowCount != "number" || isNaN(updatedRowCount)) {
       log.error(`SKip: ${skip}, FetchRecord: ${fetchRecords.length}`);
       log.error(
         "updatedRowCount identified is not a number for schema with element name: " +
           connectorDetails.elementName
       );
       process.exit(1);
     }
     mappedPayload = mappedPayload.map((element) => {
       if (!element.assetid) {
         element.assetid = 0;
       }
       element = {
         ...element,
         ...(defaultMappings || {}),
       };
       return element;
     });

     let toUpdatePromise = [];
     // console.log(mappedPayload)
     if (detail.mode) {
       if (detail.mode.update) {
         if (detail.mode.key) {
           const toUpdate = mappedPayload.filter(
             (item) => item.status == "updated"
           );
           if (toUpdate.length) {
             mappedPayload = mappedPayload.filter(
               (item) => item.status != "updated"
             );
             // update
             toUpdatePromise = toUpdate.map((item) => {
               if (!item.assetid) {
                 item.assetid = 0;
               }
               const keyValue = item[detail.mode.key];
               const query = encodeURI(
                 `query=${detail.mode.key}=="${keyValue}"`
               );
               log.info(`Update query : ${JSON.stringify(query)}`);
               log.error(`Update ${detail.mode.key} :${keyValue}`);
               log.error(`Update Payload : ${JSON.stringify(item)}`);
               return ElementService.updateElementRecordsByQuery(
                 detail.elementName,
                 item,
                 query
               );
             });
           }
         }
       }
     }
     try {
       if (toUpdatePromise.length) {
         await Promise.all(toUpdatePromise);
       }
       log.error(`updatedRowCount: ${updatedRowCount}`);
       writeRecordInSWX(mappedPayload, updatedRowCount,  detail.elementName);
     } catch (ex) {
       log.error(ex);
       process.exit(1);
     }
   } else {
     log.fatal(`No Record found for ${detail.tableName}`);
     process.exit(1);
   }
 }

 async function writeRecordInSWX(finalMappedPayload, updatedRowCount, elementName) {
   try {
     if (finalMappedPayload.length == 0) {
       fs.writeFile(
         dir,
         `${updatedRowCount}`,
         config.writeFileEncoding,
         (error) => {
           if (error) {
             log.error("Error occured while writing to " + dir + ": " + error);
             process.exit(1);
           }
           /**
            * Log the information regarding the udpated row of the data from the corresponding table.
            * Read max data value to initiate skip value on second execution.
            */
           log.info(
             `No. of Rows fetched Till date: ${updatedRowCount} | Table Name: ${detail.tableName}`
           );
           sequelizeObj = null;
           sequelizeTable = null;
           process.exit(1);
         }
       );
     } else {
       log.error(
         "Final Payload(" +
           finalMappedPayload.length +
           " Records) : " +
           JSON.stringify(finalMappedPayload)
       );

       const response = await ElementService.createElementMultipleRecords(
         detail.elementName,
         finalMappedPayload
       );
       if (response.status === HTTP_STATUS_CODE.SUCCESS) {
         log.error(
           `${
             detail.elementName
           } Record saved successfully in ShopWorx ${JSON.stringify(
             response.data
           )}`
         );
         const results = response.data.results;
         if (!results) {
           log.error(
             "Unable to identify results when response retrieved from server."
           );
           process.exit(1);
         }
         let dataArray = JSON.parse(JSON.stringify(results));
         log.error(
           "Retrieved response from Server (Total Records: " +
             dataArray.length +
             "): " +
             JSON.stringify(response.data)
         );
         if (dataArray.includes("false")) {
           log.error(
             "Error occurred while attempting to insert records on Server." +
               " check if the parameters userId and customerId in config.json file are valid (i.e whether" +
               "customer has access to the elements)"
           );
           process.exit(1);
         }
         if (detail.elementName == 'order') {

          let orderquery = `query=ordername=="${finalMappedPayload[0].ordername}"`;
         orderquery += `&sortquery=createdTimestamp==-1&pagenumber=1&pagesize=1`;
         const orderresponse = await ElementService.getElementRecords(
           "order",
           orderquery
         );
         if (orderresponse.status == HTTP_STATUS_CODE.SUCCESS) {
           let order = orderresponse.data.results[0];
           let ordernumber = order.ordernumber;
           const substationresponse = await ElementService.getElementRecords(
             "substation"
           );
           if (substationresponse.status == HTTP_STATUS_CODE.SUCCESS) {
             if (
               substationresponse.data &&
               substationresponse.data.results &&
               substationresponse.data.results.length > 0
             ) {
               // add order product
               let orderproductpromises = substationresponse.data.results.map(
                 (item) => {
                   return new Promise((resolve) => {
                     let payload = {
                       lineid: 1,
                       orderid: ordernumber,
                       ordername: finalMappedPayload[0].ordername,
                       productid: finalMappedPayload[0].productid,
                       sublineid: item.sublineid,
                       substationid: item.id,
                     };
                     writeorderproduct(payload, resolve);
                   });
                 }
               );
               // add order roadmap
               let orderroadmappromises = substationresponse.data.results.map(
                 (item) => {
                   return new Promise((resolve) => {
                     writeorderroadmap(
                       ordernumber,
                       finalMappedPayload[0].roadmapid,
                       item.id,
                       resolve
                     );
                   });
                 }
               );
               await Promise.all([
                 ...orderproductpromises,
                 ...orderroadmappromises,
               ]);
               fs.writeFile(
                dir,
                `${updatedRowCount}`,
                config.writeFileEncoding,
                (error) => {
                  if (error) {
                    log.error("Error occured while writing to " + dir + ": " + error);
                    process.exit(1);
                  }
                  /**
                   * Log the information regarding the udpated row of the data from the corresponding table.
                   * Read max data value to initiate skip value on second execution.
                   */
                  log.info(
                    `No. of Rows fetched Till date: ${updatedRowCount} | Table Name: ${detail.tableName}`
                  );
                  sequelizeObj = null;
                  sequelizeTable = null;
                  process.exit(1);
                }
              );
             }
           } else {
            checkSessionExpired(response.data);
            log.error(
             'Error in writing new order data in ShopWorx'
            );
            process.exit(1);
           }
         } else {
           checkSessionExpired(response.data);
           log.error(
            'Error in writing new order data in ShopWorx'
           );
           process.exit(1);
         }
         } else {
          fs.writeFile(
            dir,
            `${updatedRowCount}`,
            config.writeFileEncoding,
            (error) => {
              if (error) {
                log.error("Error occured while writing to " + dir + ": " + error);
                process.exit(1);
              }
              /**
               * Log the information regarding the udpated row of the data from the corresponding table.
               * Read max data value to initiate skip value on second execution.
               */
              log.error(
                `No. of Rows fetched Till date: ${updatedRowCount} | Table Name: ${detail.tableName}`
              );
              sequelizeObj = null;
              sequelizeTable = null;
              process.exit(1);
            }
          );
         }



       } else {

         log.error(
           `Error in writing ${detail.elementName} in ShopWorx ${JSON.stringify(
             response.data
           )}`
         );
         checkSessionExpired(response.data);
         process.exit(1);
       }
     }
   } catch (err) {
     log.error(
       "Error caught while calling Create Bulk API: " +
         (err.message ? err.message : err)
     );
     // process.exit(1);
   }
 }

 async function getMappedPayload(connectorDetails, records) {
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
       if (connectorDetails.removeFromPayload.includes(key)) {
         // continue and do not add it to the payload.
         continue;
       }
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
         const value = null;
         log.info(
           "Setting default value for key: " + key + ", value:  " + value
         );
         jsonObj[key] = value;
       }
     }
     if (jsonObj && Object.keys(jsonObj).length) {
       // adding a timestamp field since we get shifts related data in MongoDB end as well.
       jsonObj["timestamp"] = moment().toDate().getTime();
       if (connectorDetails.elementName == "order") {
         let producttypequery = `query=productname=="${jsonObj.productname}"`;
         const producttyperesponse = await ElementService.getElementRecords(
           "part",
           producttypequery
         );
         if (producttyperesponse.status == HTTP_STATUS_CODE.SUCCESS) {
           if (
             producttyperesponse.data &&
             producttyperesponse.data.results &&
             producttyperesponse.data.results.length > 0
           ) {
             const bomid = producttyperesponse.data.results[0].bomid;
             const productnumber =
               producttyperesponse.data.results[0].productnumber;
             jsonObj.bomid = bomid;
             jsonObj.productid = productnumber;

             jsonObj.roadmapid = producttyperesponse.data.results[0].roadmapid;
             jsonObj.roadmapname =
               producttyperesponse.data.results[0].roadmapname;
             jsonObj.roadmaptype =
               producttyperesponse.data.results[0].roadmaptype;
             JSONArray.push(jsonObj);
           } else {
             log.error(
               `no part data in ShopWorx ${JSON.stringify(
                 producttyperesponse.data
               )}`
             );
             process.exit(1);
           }
         } else {

           log.error(
             `Error in getting part in ShopWorx ${JSON.stringify(
               producttyperesponse.data
             )}`
           );
           checkSessionExpired(response.data);
           process.exit(1);
         }
       } else {
         JSONArray.push(jsonObj);
       }
     } else {
       log.error(
         "No Json object created with record: " + JSON.stringify(records[j])
       );
     }
   }
   log.trace(
     "ElementName: " +
       connectorDetails.elementName +
       ", Final Payload: " +
       JSON.stringify(JSONArray)
   );
   return JSONArray;
 }

 async function writeorderproduct(payload, resolve) {
  const elementName = 'orderproduct';
  payload.assetid = 4;
  const response = await ElementService.createElementRecord(
    elementName,
    payload
  );
  if (response.status === HTTP_STATUS_CODE.SUCCESS) {
    log.error(
      `Record saved successfully in ShopWorx for orderroadmap ${JSON.stringify(
        response.data
      )}`
    );
    if (resolve) resolve();
  } else {
    if (resolve) resolve();
    log.error(
      `Error in writing orderroadmap data in ShopWorx ${JSON.stringify(
        response.data
      )}`
    );
    checkSessionExpired(response.data);
    process.exit(1);
  }
}
async function writeorderroadmap(
  ordernumber,
  roadmapid,
  substationid,
  resolve
) {
  // roadmap detail
  let roadmapdetailquery = `query=roadmapid=="${roadmapid}"`;
  roadmapdetailquery += `%26%26substationid=="${substationid}"`;
  const roadmapdetailresponse = await ElementService.getElementRecords(
    'roadmapdetails',
    roadmapdetailquery
  );
  if (roadmapdetailresponse.status == HTTP_STATUS_CODE.SUCCESS) {
    if (
      roadmapdetailresponse.data &&
      roadmapdetailresponse.data.results &&
      roadmapdetailresponse.data.results.length > 0
    ) {
      const roadmapdetail = roadmapdetailresponse.data.results[0];
      const elementName = 'orderroadmap';
      let payload = {
        amtpresubstation: roadmapdetail.amtpresubstation,
        assetid:  4,
        lineid: 1,
        orderid: ordernumber,
        prestationid: roadmapdetail.prestationid,
        prestationname: roadmapdetail.prestationname,
        presubstationid: roadmapdetail.presubstationid,
        presubstationname: roadmapdetail.presubstationname,
        roadmapid: roadmapdetail.roadmapid,
        sublineid: roadmapdetail.sublineid,
        sublinename: roadmapdetail.sublinename,
        substationid: roadmapdetail.substationid,
        substationname: roadmapdetail.substationname,
      };
      const response = await ElementService.createElementRecord(
        elementName,
        payload
      );
      if (response.status === HTTP_STATUS_CODE.SUCCESS) {
        log.error(
          `Record saved successfully in ShopWorx for orderroadmap ${JSON.stringify(
            response.data
          )}`
        );
        if (resolve) resolve();
      } else {
        if (resolve) resolve();
        log.error(
          `Error in writing orderroadmap data in ShopWorx ${JSON.stringify(
            response.data
          )}`
        );
        checkSessionExpired(response.data);
           process.exit(1);
      }
    } else {
      resolve();
    }
  } else {
    log.error(
      `Error in writing orderroadmap data in ShopWorx ${JSON.stringify(
        roadmapdetailresponse.data
      )}`
    );
    checkSessionExpired(roadmapdetailresponse.data);
    process.exit(1);
  }
}
