const mssql = require('mssql');
const adbConfig = {    user: 'tgcsmaintadmin@tgcsmaintsql',
    password: 'T0shiba!',
    server: 'tgcsmaintsql.database.windows.net',
    port: 1433,
    database: 'enriched',
    authentication: {
        type: 'default'
    },
    options: {
        encrypt: true,
		trustServerCertificate: false,
		hostNameInCertificate: "*.database.windows.net",
		loginTimeout: 30
    }
}

async function getConnection() {
	return await mssql.connect(adbConfig)
}

module.exports = getConnection