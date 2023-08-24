let mssql = require('../middleware/mssql-pool-management')
const SqlString = require('tsqlstring');
const mongodb = require("mongodb")
const sql = require('mssql');

var azureClient = new mongodb.MongoClient("mongodb://pas-test-nosql-db:1Xur1znUvMn4Ny2xW4BwMjN1eHXYPpCniT8eU3nfnnGVtbV7RVUDotMz9E7Un226yrCyjXyukDDSSxLjNUUyaQ%3D%3D@pas-test-nosql-db.mongo.cosmos.azure.com:10255/?ssl=true&retrywrites=false&maxIdleTimeMS=120000&appName=@pas-test-nosql-db@");
azureClient.connect();

module.exports = function (app) {
    app.get('/rsmpData/getAlerts', (req, res) => {
        console.log('rsmpData/getAlerts called with: ', req.query)
        var retailerDetails = azureClient.db("pas_software_distribution").collection("retailers");
        retailerDetails.findOne({ retailer_id: req.query["retailerId"] }, async function (err, retailer) {
            if (retailer) {
                if (req.query["isLab"] === 'false') {
                    console.log('in prod system: ', retailer.description)
                    let sqlPool = await mssql.GetCreateIfNotExistPool('prod')
                    let request = new sql.Request(sqlPool)
                    let query = SqlString.format(`select StoreNumber = st.StoreNumber, AgentName = pa.StoreAssetId, AlertSeverity = nas.[Level], AlertType = nat.TypeName, AlertLabel = na.[Label], AlertThreshold = na.Threshold, AlertCurrentReading = na.CurrentReading, AlertCollectedTime = na.CollectedTime, AlertCreatedTime = na.CreatedTime from store.Retailer rt with(Nolock) join store.Brand br with(nolock) on br.RetailerId = rt.Id join store.Store st with(nolock) on st.BrandId = br.Id join store.PosAsset pa with(nolock) on pa.StoreId = st.Id join store.NativeAlert na with(nolock) on na.PosAssetId = pa.Id join store.AlertSeverity nas with(nolock) on na.SeverityId = nas.Id join store.AlertType nat with(nolock) on na.TypeId = nat.Id left join store.UpdnPeripheral updn with(nolock) on na.PosAssetId = updn.PosAssetId and na.PeripheralId = updn.Id left join store.UpdnCategory updnc with(nolock) on updn.UpdnCategoryId = updnc.Id where rt.IsRemoved = 0 and rt.[Name] = ? and br.IsRemoved = 0 and st.IsRemoved = 0 and pa.IsRemoved = 0 and isnull(updn.IsRemoved,0) = 0 and na.ResolvedTime is null`, [retailer.description])
                    request.query(query, (err, results) => {
                        if (err) {
                            console.log('sql error', err)
                        } else {
                            res.send(results.recordset)
                        }
                    })
                } else if (req.query["isLab"] === 'true') {
                    console.log('In lab system: ', retailer.description)
                    let sqlPool = await mssql.GetCreateIfNotExistPool('staging')
                    let request = new sql.Request(sqlPool)
                    let query = SqlString.format(`select StoreNumber = st.StoreNumber, AgentName = pa.StoreAssetId, AlertSeverity = nas.[Level], AlertType = nat.TypeName, AlertLabel = na.[Label], AlertThreshold = na.Threshold, AlertCurrentReading = na.CurrentReading, AlertCollectedTime = na.CollectedTime, AlertCreatedTime = na.CreatedTime from store.Retailer rt with(Nolock) join store.Brand br with(nolock) on br.RetailerId = rt.Id join store.Store st with(nolock) on st.BrandId = br.Id join store.PosAsset pa with(nolock) on pa.StoreId = st.Id join store.NativeAlert na with(nolock) on na.PosAssetId = pa.Id join store.AlertSeverity nas with(nolock) on na.SeverityId = nas.Id join store.AlertType nat with(nolock) on na.TypeId = nat.Id left join store.UpdnPeripheral updn with(nolock) on na.PosAssetId = updn.PosAssetId and na.PeripheralId = updn.Id left join store.UpdnCategory updnc with(nolock) on updn.UpdnCategoryId = updnc.Id where rt.IsRemoved = 0 and rt.[Name] = ? and br.IsRemoved = 0 and st.IsRemoved = 0 and pa.IsRemoved = 0 and isnull(updn.IsRemoved,0) = 0 and na.ResolvedTime is null`, [retailer.description])
                    request.query(query, (err, results) => {
                        if (err) {
                            console.log('sql error', err)
                        } else {
                            res.send(results.recordset)
                        }
                    })
                }
            }
        })
    });

    app.get('/rsmpData/getMobileAssets', (req, res) => {
        console.log('rsmpData/getMobileAssets called with: ', req.query)
        var retailerDetails = azureClient.db("pas_software_distribution").collection("retailers");
        retailerDetails.findOne({ retailer_id: req.query["retailerId"] }, async function (err, retailer) {
            if (retailer) {
                if (req.query["isLab"] === 'false') {
                    console.log('in prod system: ', retailer.description)
                    let sqlPool = await mssql.GetCreateIfNotExistPool('prod')
                    let request = new sql.Request(sqlPool)
                    let query = SqlString.format(` select 
                    store.StoreNumber storeName,
                    mobileAsset.StoreAssetId assetId, mobileAsset.IpAddress ipAddress, mobileAsset.MacAddress macAddress, mobileAsset.Model model, 
                    mobileAsset.Manufacturer, mobileAsset.OsType, mobileAsset.OsVersion, mobileAsset.UpdatedTime updatedTime, opStatus.Status online
                    from [store].[MobileAsset] mobileAsset
                    left join [store].[Store] store
                    on store.id = mobileAsset.storeId
                    left join [store].[Brand] brand
                    on brand.id = store.BrandId
                    left join [store].[Retailer] retailer
                    on brand.RetailerId = retailer.Id
                    left join [store].[OperationalStatus] opStatus
                    on mobileAsset.OperationalStatusId = opStatus.Id
                    where retailer.name = ?`, [retailer.description])
                    request.query(query, (err, results) => {
                        if (err) {
                            console.log('sql error', err)
                        } else {
                            res.send(results.recordset)
                        }
                    })
                } else if (req.query["isLab"] === 'true') {
                    console.log('In lab system: ', retailer.description)
                    let sqlPool = await mssql.GetCreateIfNotExistPool('staging')
                    let request = new sql.Request(sqlPool)
                    let query = SqlString.format(` select 
                    store.StoreNumber storeName,
                    mobileAsset.StoreAssetId assetId, mobileAsset.IpAddress ipAddress, mobileAsset.MacAddress macAddress, mobileAsset.Model model, 
                    mobileAsset.Manufacturer, mobileAsset.OsType, mobileAsset.OsVersion, mobileAsset.UpdatedTime updatedTime, opStatus.Status online
                    from [store].[MobileAsset] mobileAsset
                    left join [store].[Store] store
                    on store.id = mobileAsset.storeId
                    left join [store].[Brand] brand
                    on brand.id = store.BrandId
                    left join [store].[Retailer] retailer
                    on brand.RetailerId = retailer.Id
                    left join [store].[OperationalStatus] opStatus
                    on mobileAsset.OperationalStatusId = opStatus.Id
                    where retailer.name = ?`, [retailer.description])
                    request.query(query, (err, results) => {
                        if (err) {
                            console.log('sql error', err)
                        } else {
                            res.send(results.recordset)
                        }
                    })
                }
            }
        })
    });

    app.get('/rsmpData/getWirelessPeripherals', (req, res) => {
        console.log('rsmpData/getWirelessPeripherals called with: ', req.query)
        var retailerDetails = azureClient.db("pas_software_distribution").collection("retailers");
        retailerDetails.findOne({ retailer_id: req.query["retailerId"] }, async function (err, retailer) {
            if (retailer) {
                if (req.query["isLab"] === 'false') {
                    console.log('in prod system: ', retailer.description)
                    let sqlPool = await mssql.GetCreateIfNotExistPool('prod')
                    let request = new sql.Request(sqlPool)
                    let query = SqlString.format(`SELECT
                    store.StoreNumber storeName,
                    [PeripheralType] -- 1 === printer
                    ,wp.[Model] model
                    ,[FirmwareVersion] firmware
                    ,wp.[OSVersion] osVersion
                    ,[BluetoothId] bluetoothId
                    ,[BluetoothAddress] bluetoothAddress
                    ,[BluetoothRadioVersion] bluetoothRadioVersion
                    ,[BluetoothLibraryVersion] bluetoothLibraryVersion
                    ,[FreeRAMMemory] freeRam
                    ,[TotalRAMMemory] totalRam
                    ,[TotalFlashMemory] totalFlash
                    ,[FreeFlashMemory] freeFlash
                    ,[DeviceUpTime] deviceUptime
                FROM [store].[WirelessPeripheral] wp
                left join [store].[MobileAsset] mobileAsset
                on mobileAsset.Id = wp.AssetId
                  left join [store].[Store] store
                on store.id = mobileAsset.storeId
                left join [store].[Brand] brand
                on brand.id = store.BrandId
                left join [store].[Retailer] retailer
                on brand.RetailerId = retailer.Id
                left join [store].[OperationalStatus] opStatus
                on mobileAsset.OperationalStatusId = opStatus.Id
                where retailer.name = ?`, [retailer.description])
                    request.query(query, (err, results) => {
                        if (err) {
                            console.log('sql error', err)
                        } else {
                            res.send(results.recordset)
                        }
                    })
                } else if (req.query["isLab"] === 'true') {
                    console.log('In lab system: ', retailer.description)
                    let sqlPool = await mssql.GetCreateIfNotExistPool('staging')
                    let request = new sql.Request(sqlPool)
                    let query = SqlString.format(`SELECT
                    store.StoreNumber storeName,
                    [PeripheralType] -- 1 === printer
                    ,wp.[Model] model
                    ,[FirmwareVersion] firmware
                    ,wp.[OSVersion] osVersion
                    ,[BluetoothId] bluetoothId
                    ,[BluetoothAddress] bluetoothAddress
                    ,[BluetoothRadioVersion] bluetoothRadioVersion
                    ,[BluetoothLibraryVersion] bluetoothLibraryVersion
                    ,[FreeRAMMemory] freeRam
                    ,[TotalRAMMemory] totalRam
                    ,[TotalFlashMemory] totalFlash
                    ,[FreeFlashMemory] freeFlash
                    ,[DeviceUpTime] deviceUptime
                FROM [store].[WirelessPeripheral] wp
                left join [store].[MobileAsset] mobileAsset
                on mobileAsset.Id = wp.AssetId
                  left join [store].[Store] store
                on store.id = mobileAsset.storeId
                left join [store].[Brand] brand
                on brand.id = store.BrandId
                left join [store].[Retailer] retailer
                on brand.RetailerId = retailer.Id
                left join [store].[OperationalStatus] opStatus
                on mobileAsset.OperationalStatusId = opStatus.Id
                where retailer.name = ?`, [retailer.description])
                    request.query(query, (err, results) => {
                        if (err) {
                            console.log('sql error', err)
                        } else {
                            res.send(results.recordset)
                        }
                    })
                }
            }
        })
    });
}