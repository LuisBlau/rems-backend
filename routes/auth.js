
const jwt = require('jsonwebtoken');
module.exports = function (app, connection, log) {
	app.get("/auth/login",(req,res) => {
		console.log("hi")
		var c = jwt.sign({
			exp: Math.floor(Date.now() / 1000) + (60 * 60), //expires in 1 hour
			data: {"username":"unknown"}
		}, secret)
		console.log(c)
		res.cookie("auth",c);
		res.send(200)
	})
	app.get("/auth/checkauth",(req,res) => {
		try {
			var decoded = jwt.verify(req.cookie("auth"), secret);
		} catch(err) {
			// the cookie is invalid
			res.send(403)
			return
		}
		console.log(decoded)
		if(decoded.data.username == undefined) {
			res.send(403)
			console.log("invalid username")
			return
		}
		res.send(200)
	})
}