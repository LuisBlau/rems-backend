const jwt = require('jsonwebtoken');

module.exports = () => {
	return function(req,res,next) {
		if(req.path.startsWith("/auth")) {
			next()
			return
		}
		if(req.cookies["auth"] == null) {
			res.send(403)
			return
		}
		try {
			var decoded = jwt.verify(req.cookies["auth"], secret);
		} catch(err) {
			// the cookie is invalid
			res.send(403)
			return
		}
		console.log(decoded)
		if(decoded.data.username == undefined) {
			res.send(403)
			return
		}
		res.cookie("auth",jwt.sign({
			exp: Math.floor(Date.now() / 1000) + (60 * 60), //expires in 1 hour
			data: decoded.data
		}, secret));
	}
}