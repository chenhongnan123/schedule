const nodePackage = require('../service/nodepackage.service');
const NodePackage = nodePackage.NodePackage;
const axios = NodePackage.axios;

class ApiService {
  constructor(server) {
    this.instance = axios.create({
      baseURL: `${server.protocol}://${server.host}:${server.port}`,
    });
  }

  setTimeout(timeout) {
    this.instance.defaults.timeout = (timeout || 5) * 1000
  }

  setDefaultHeader(loginType) {
    this.instance.defaults.headers.common.loginType = loginType;
  }

  setHeader(session) {
    this.instance.defaults.headers.common.sessionId = session;
    this.instance.defaults.headers.cookie = `JSESSIONID=${session}; sessionId=${session}`;
  }

  removeHeader() {
    this.instance.defaults.headers.common = {}
  }

  request(method, url, data = {}, config = {}) {
    return this.instance({
      method,
      url,
      data,
      ...config,
    });
  }

  get(url, config = {}) {
    return this.request('GET', url, {}, config);
  }

  post(url, data, config = {}) {
    return this.request('POST', url, data, config);
  }

  put(url, data, config = {}) {
    return this.request('PUT', url, data, config);
  }

  patch(url, data, config = {}) {
    return this.request('PATCH', url, data, config);
  }

  delete(url, config = {}) {
    return this.request('DELETE', url, {}, config);
  }
}

const HTTP_STATUS_CODE = {
  SUCCESS: 200,
  ACCEPTED: 202,
  BAD_REQUEST: 406,
  NOT_ACCEPTABLE: 406,
  INTERNAL_SERVER_ERROR: 500
}

async function setTimer(time) {
  time = time || 1; // default time is 1 seconds if time not passed from function
  // eslint-disable-next-line no-undef
  await new Promise(resolve => setTimeout(resolve, time * 1000));
}

const swap = (obj) => {
  const ret = {};
  Object.keys(obj).forEach((key) => {
    ret[obj[key]] = key;
  });
  return ret;
}

module.exports = {
  HTTP_STATUS_CODE,
  setTimer,
  ApiService,
  swap
};