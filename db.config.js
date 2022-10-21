module.exports = {
  HOST: '10.89.196.159',
  USER: 'logstash',
  PASSWORD: 'Password',
  DB: 'logs',
  dialect: 'mysql',
  pool: {
    max: 5,
    min: 0,
    acquire: 30000,
    idle: 10000
  }
}
