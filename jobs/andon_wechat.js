const Worker = require('bthreads');
const basic = require('./basic');
const nodePackage = require('../service/nodepackage.service');

const { HTTP_STATUS_CODE } = basic;
const { workerData } = Worker;
const { taskData, config, tags, tokenPayload } = workerData;
const { corpid, corpsecret, agentid } = tokenPayload;
const context = JSON.parse(taskData.context);
const alertrole = JSON.parse(taskData.alertrole);
const NodePackage = nodePackage.NodePackage;
const bunyan = NodePackage.bunyan;
const axios = NodePackage.axios;
const datefns = NodePackage.datefns;
const { format } = datefns;
const andonTags = tags.andontasktags;

const log = bunyan.createLogger({
  name: `AndonTask for ${taskData[andonTags.ID_TAG]}`,
  level: config.logger.loglevel,
});

// Init Shopworx ApiService

async function PostWeChat() {
  const token = await axios.get(`https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${corpid}&corpsecret=${corpsecret}`);
  if (token.status === HTTP_STATUS_CODE.SUCCESS) {
    const { data } = token;
    if (data.errmsg === 'ok') {
      const { access_token } = data;
      const url = `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${access_token}`;
      alertrole.forEach(async role => {
        const payload = {
          "totag": role.wechatid,
          "msgtype": "text",
          "agentid": agentid,
          "text": {
            "content": `${context.typedescription} 提示!
提交时间超过 ${context.alertdelay}${context.unit === 1 ? '分钟' : '小时'}, 请关注！
设备: ${context.machinename}
计划: ${context.planid}
物料编号: ${context.partname}
物料名称: ${context.partname} 
模具: ${context.moldname}
提交人工号: ${context.createdbycode}
提交人姓名: ${context.createdbyname.map((item) => String.fromCharCode(Number(item))).join('')}
提交时间: ${format(new Date(context.starttimestamp), "yyyy-MM-dd HH:mm")}`,
          }
        };

        const result = await axios.post(url, payload);
        log.error(`Wechat result ${JSON.stringify(result.data)}`);
      });
    } else {
      log.error(`Error in getting TOKEN ${JSON.stringify(token)}`);
    }
  } else {
    log.error(`Error in getting TOKEN ${JSON.stringify(token)}`);
  }
}

PostWeChat();
