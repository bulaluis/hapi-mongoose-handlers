// Load modules

var Lab = require('lab');
var Async = require('async');
var Code = require('code');
var Hoek = require('hoek');
var Hapi = require('hapi');
var Plugin = require('../lib');
var Mongoose = require('mongoose');
var Lodash = require('lodash');
var HapiMongooseRequest = require('hapi-mongoose-request');
var Qs = require('qs');


// Tests

var lab = exports.lab = Lab.script();
var routes = [{
    method: 'GET',
    path: '/v1/{model}/{id?}',
    handler: {
        find: {},
    }
}, {
    method: 'GET',
    path: '/v2/{model}/{id?}',
    handler: {
        find: {}
    },
    config: {
        pre: [{
            method: function (request, reply) {
                reply({})
            },
            assign: 'conditions'
        }]
    }
}, {
    method: 'POST',
    path: '/v1/{model}',
    handler: {
        create: {},
    }
}, {
    method: 'PUT',
    path: '/v1/{model}/{id}',
    handler: {
        update: {},
    }
}, {
    method: 'DELETE',
    path: '/v1/{model}/{id}',
    handler: {
        remove: {},
    }
}];
var adminId;
var userId;


lab.before(function (done) {

    Mongoose.connect('mongodb://localhost/test-hapi-mongoose-handlers', function (err) {

        Hoek.assert(!err, err);

        Mongoose.model('Role', new Mongoose.Schema({
            name: String,
            permissions: Array
        }));

        var schema = new Mongoose.Schema({
            username: {
                type: String,
                required: true
            },
            password: String,
            role: {
                type: Mongoose.Schema.Types.ObjectId,
                ref: 'Role'
            }
        });
        schema.methods.touch = function () {};
        Mongoose.model('User', schema);

        Mongoose.model('Admin', new Mongoose.Schema({
            name: String,
            age: Number,
            user: {
                type: Mongoose.Schema.Types.ObjectId,
                ref: 'User'
            }
        }));

        return done();
    });
});

// Connect with database and create fixture data

lab.before(function (done) {

    Async.parallel([
        function (callback) {

            Mongoose.model('User').remove({}, callback);
        },
        function (callback) {

            Mongoose.model('Role').remove({}, callback);
        },
        function (callback) {

            Mongoose.model('Admin').remove({}, callback);
        }
    ], function (err) {

        if (err) {
            return done(err);
        }

        Async.waterfall([
            function (callback) {

                Mongoose.model('Role').create({
                    name: 'admin',
                    permissions: ['update', 'create', 'remove']
                }, callback);
            },
            function (role, callback) {

                Mongoose.model('User').create({
                    username: 'admin',
                    password: 'admin',
                    role: role
                }, callback);
            },
            function (user, callback) {

                userId = user._id;
                var admins = [];
                for (var i = 0; i < 20; ++i) {
                    admins.push({
                        name: 'Administrator ' + i,
                        age: 10 + i,
                        user: user
                    });
                }
                Mongoose.model('Admin').create(admins, function (err, docs) {
                    adminId = docs && docs[0] && docs[0].id;
                    return callback(err);
                });
            }
        ], function (err) {

            return done(err);
        });
    });
});

lab.experiment('Hapi-mongoose-handlers', function () {

    lab.experiment('with `hapi-mongoose-request` `find: [function], update: [object], where: false`', function () {

        var server;
        var newUserId;

        lab.before(function (done) {

            server = new Hapi.Server();
            server.connection({ port: 3000 });
            return done();
        });

        lab.test('successfully registered', function (done) {

            server.register([{
                register: HapiMongooseRequest,
                options: {
                    param: 'model',
                    capitalize: true,
                    singularize: true
                }
            }, {
                register: Plugin,
                options: {
                    find: function (route, options) {
                        return function (request, reply) {
                            return reply('ok');
                        }
                    },
                    update: {
                        plugins: {
                            policies: {
                                acl: ['canUpdate']
                            }
                        }
                    },
                    onCreate: 'object',
                    onUpdate: 'object',
                    onRemove: 'object'
                }
            }], function (err) {

                Code.expect(err).to.not.exist();
                server.route(routes);
                return done();
            });
        });

        lab.test('inject request `/admins`, it returns `ok` message', function (done) {

            var request = {
                method: 'GET',
                url: '/v1/admins',
            };
            server.inject(request, function (response) {

                Code.expect(response.statusCode).to.be.equal(200);
                Code.expect(response.result).to.be.equal('ok');
                return done();
            });
        });

        lab.test('inject request `/admins` with query params `where: { _id: randomId }`, it returns `ok` message', function (done) {

            var query = {
                where: { _id: adminId }
            };
            var request = {
                method: 'GET',
                url: '/v1/admins?' + Qs.stringify(query)
            };
            server.inject(request, function (response) {

                Code.expect(response.statusCode).to.be.equal(200);
                Code.expect(response.result).to.be.equal('ok');
                return done();
            });
        });

        lab.test('inject request `/admins/{adminId}`, it returns `ok` message', function (done) {

            var request = {
                method: 'GET',
                url: '/v1/admins' + Mongoose.Types.ObjectId(),
            };
            server.inject(request, function (response) {

                Code.expect(response.statusCode).to.be.equal(200);
                Code.expect(response.result).to.be.equal('ok');
                return done();
            });
        });

        lab.test('inject request `POST /users` it returns statusCode 200 and one record', function (done) {

            var request = {
                method: 'POST',
                url: '/v1/users',
                payload: {
                    user: {
                        username: 'bula',
                        password: 'bula'
                    }
                }
            };
            server.inject(request, function (response) {

                newUserId = response.result.User.id;
                Code.expect(response.statusCode).to.be.equal(200);
                Code.expect(response.result).to.be.an.object();
                Code.expect(response.result.User.username).to.be.equal('bula');
                return done();
            });
        });

        lab.test('inject request `PUT /users/{userId}` it returns statusCode 200 and record with data updated', function (done) {

            var request = {
                method: 'PUT',
                url: '/v1/users/' + userId,
                payload: {
                    user: {
                        username: 'new username'
                    }
                }
            };
            server.inject(request, function (response) {

                Code.expect(response.statusCode).to.be.equal(200);
                Code.expect(response.result).to.be.an.object();
                Code.expect(response.result.User.username).to.be.equal('new username');
                return done();
            });
        });

        lab.test('inject request `DELETE /users/{userId}` it returns statusCode 200 and record which it was removed', function (done) {

            var request = {
                method: 'DELETE',
                url: '/v1/users/' + newUserId
            };
            server.inject(request, function (response) {

                Code.expect(response.statusCode).to.be.equal(200);
                Code.expect(response.result).to.be.an.object();
                Code.expect(response.result.User.id).to.be.equal(newUserId);
                return done();
            });
        });

        lab.after(function (done) {
            server.stop(function (err) {

                return done(err);
            });
        });
    });

    lab.experiment('with `hapi-mongoose-request` `where : true`', function () {

        var server;

        lab.before(function (done) {

            server = new Hapi.Server();
            server.connection({ port: 3000 });
            return done();
        });

        lab.test('successfully registered', function (done) {

            server.register([{
                register: HapiMongooseRequest,
                options: {
                    param: 'model',
                    capitalize: true,
                    singularize: true
                }
            }, {
                register: Plugin,
                options: {
                    where: true
                }
            }], function (err) {

                Code.expect(err).to.not.exist();

                server.route(routes);

                return done();
            });
        });

        lab.experiment('inject request `/admins`', function () {

            lab.test('without query params it returns 20 records', function (done) {

                var request = {
                    method: 'GET',
                    url: '/v1/admins'
                };
                server.inject(request, function (response) {

                    Code.expect(response.statusCode).to.be.equal(200);
                    Code.expect(response.result.Admin).to.be.an.array();
                    Code.expect(response.result.Admin).to.have.length(20);
                    Code.expect(response.result.meta.totalDocs).to.equal(20);
                    Code.expect(response.result.meta.totalPages).to.equal(1);

                    return done();
                });
            });

            lab.test('with query params `where: { _id: adminId }`, it returns admin record', function (done) {

                var query = {
                    where: { _id: adminId }
                };
                var request = {
                    method: 'GET',
                    url: '/v1/admins?' + Qs.stringify(query)
                };
                server.inject(request, function (response) {

                    Code.expect(response.statusCode).to.be.equal(200);
                    Code.expect(response.result.Admin.id).to.be.equal(adminId);
                    return done();
                });
            });

            lab.test('with query params `where: { _id: randomId }`, it returns statusCode 404', function (done) {

                var query = {
                    where: { _id: String(Mongoose.Types.ObjectId()) }
                };
                var request = {
                    method: 'GET',
                    url: '/v1/admins?' + Qs.stringify(query)
                };
                server.inject(request, function (response) {

                    Code.expect(response.statusCode).to.be.equal(404);
                    return done();
                });
            });

            lab.test('with query params `where: { age: { $gte : 17 } }`, it returns 13 records (with true sanitize options)', function (done) {

                var query = {
                    where: { age: { $gte : 17 } }
                };
                var request = {
                    method: 'GET',
                    url: '/v1/admins?' + Qs.stringify(query)
                };
                server.inject(request, function (response) {

                    Code.expect(response.statusCode).to.be.equal(200);
                    Code.expect(response.result.Admin).to.be.an.array();
                    Code.expect(response.result.Admin).to.have.length(13);
                    Code.expect(response.result.meta.totalDocs).to.equal(13);
                    Code.expect(response.result.meta.totalPages).to.equal(1);

                    return done();
                });
            });

            lab.test('with query params `select: { name: 1 }`, it returns 20 records', function (done) {

                var query = {
                    select: { name: 1 }
                };
                var request = {
                    method: 'GET',
                    url: '/v1/admins?' + Qs.stringify(query)
                };
                server.inject(request, function (response) {

                    Code.expect(response.statusCode).to.be.equal(200);
                    Code.expect(response.result.Admin).to.be.an.array();
                    Code.expect(response.result.Admin).to.have.length(20);
                    Code.expect(response.result.meta.totalDocs).to.equal(20);
                    Code.expect(response.result.meta.totalPages).to.equal(1);

                    return done();
                });
            });

            lab.test('with query params `limit: 10, page: 1, sort: -name, where: {}` it returns 10 records', function (done) {

                var query = {
                    limit: 10,
                    page: 1,
                    sort: '-name',
                    where: {}
                };
                var request = {
                    method: 'GET',
                    url: '/v1/admins?' + Qs.stringify(query)
                };
                server.inject(request, function (response) {

                    Code.expect(response.statusCode).to.be.equal(200);
                    Code.expect(response.result.Admin).to.be.an.array();
                    Code.expect(response.result.Admin).to.have.length(10);
                    Code.expect(response.result.meta.totalDocs).to.equal(20);
                    Code.expect(response.result.meta.totalPages).to.equal(2);

                    return done();
                });
            });

            lab.test('with `pre` support in route configuration, it returns statusCode 200', function (done) {

                var request = {
                    method: 'GET',
                    url: '/v2/admins'
                };
                server.inject(request, function (response) {

                    Code.expect(response.statusCode).to.be.equal(200);

                    return done();
                });
            });

            lab.test('with query params `page: 1` (not limit), it returns 20 records', function (done) {

                var request = {
                    method: 'GET',
                    url: '/v1/admins?page=1'
                };
                server.inject(request, function (response) {

                    Code.expect(response.statusCode).to.be.equal(200);
                    Code.expect(response.result.Admin).to.be.an.array();
                    Code.expect(response.result.Admin).to.have.length(20);

                    return done();
                });
            });

            lab.test('with query params `where: { name: Administrator 2 } `, it returns records with name Administrator 2', function (done) {

                var query = {
                    where: {
                        name: 'Administrator 2'
                    }
                };
                var request = {
                    method: 'GET',
                    url: '/v1/admins?' + Qs.stringify(query)
                };
                server.inject(request, function (response) {

                    Code.expect(response.statusCode).to.be.equal(200);
                    Code.expect(response.result.Admin).to.be.an.array();
                    Code.expect(response.result.Admin[0].toObject()).to.include({ name: 'Administrator 2'});

                    return done();
                });
            });

            lab.test('with query params `deepPopulate: [{ modelName: Role, populate: user.role }]`, it returns records with user and user.role objects', function (done) {

                var query = {
                    populate: 'user',
                    deepPopulate: [{
                        modelName: 'Role',
                        populate: 'user.role'
                    }]
                };
                var request = {
                    method: 'GET',
                    url: '/v1/admins?' + Qs.stringify(query)
                };
                server.inject(request, function (response) {

                    Code.expect(response.result).to.be.an.object();
                    Code.expect(response.result.Admin).to.be.an.array();
                    Code.expect(response.result.Admin[0].toObject()).to.include('user');
                    Code.expect(response.result.Admin[0].user.toObject()).to.include('role');

                    return done();
                });
            });
        });

        lab.experiment('inject request', function () {

            lab.test('`/admins/{adminId}`, it returns one record with id equal to {id}', function (done) {

                var request = {
                    method: 'GET',
                    url: '/v1/admins/' + adminId
                };
                server.inject(request, function (response) {

                    Code.expect(response.result).to.be.an.object();
                    Code.expect(response.result.Admin).to.be.an.object();
                    Code.expect(response.result.Admin.id).to.equal(adminId);

                    return done();
                });
            });


            lab.test('`/admins/{badId}`, it returns Boom object with statusCode 500', function (done) {

                var request = {
                    method: 'GET',
                    url: '/v1/admins/' + adminId + 33
                };
                server.inject(request, function (response) {

                    Code.expect(response.result.isBoom).to.be.true;
                    Code.expect(response.result.statusCode).to.be.equal(500);

                    return done();
                });
            });

            lab.test('`/admins/{id}` with query params `populate: User`, it returns one record with user document in properties', function (done) {

                var query = {
                    populate: 'User'
                };
                var request = {
                    method: 'GET',
                    url: '/v1/admins/' + adminId + '?' + Qs.stringify(query)
                };
                server.inject(request, function (response) {

                    Code.expect(response.result.Admin).to.be.an.object();
                    Code.expect(response.result.Admin.id).to.equal(adminId);

                    return done();
                });
            });

            lab.test('`/admins` with query params `search: 10`, it returns records whose name matches `10`', function (done) {

                var query = {
                    search: '10'
                };
                var request = {
                    method: 'GET',
                    url: '/v1/admins/?' + Qs.stringify(query)
                };
                server.inject(request, function (response) {

                    Code.expect(response.statusCode).to.be.equal(200);
                    Code.expect(response.result.Admin).to.be.an.array();
                    Code.expect(response.result.Admin[0].name).to.include('10');

                    return done();
                });
            });

            lab.test('`/nomodels`, it returns Boom object with statusCode 404', function (done) {

                var request = {
                    method: 'GET',
                    url: '/v1/nomodels'
                };
                server.inject(request, function (response) {

                    Code.expect(response.result.isBomm).to.be.true;
                    Code.expect(response.result.statusCode).to.be.equal(404);
                    return done();
                });
            });

            lab.test('`/users/{randomId}`, it returns Boom object with statusCode 404', function (done) {

                var request = {
                    method: 'GET',
                    url: '/v1/users/' + Mongoose.Types.ObjectId()
                };
                server.inject(request, function (response) {

                    Code.expect(response.result.isBomm).to.be.true;
                    Code.expect(response.result.statusCode).to.be.equal(404);
                    return done();
                });
            });

            lab.test('`DELETE /users/{userId}`, it returns statusCode 200', function (done) {

                var request = {
                    method: 'DELETE',
                    url: '/v1/users/' + userId
                };
                server.inject(request, function (response) {

                    Code.expect(response.statusCode).to.be.equal(200);
                    return done();
                });
            });

            lab.test('`DELETE /nomodel/{userId}`, it returns Boom object with statusCode 404', function (done) {

                var request = {
                    method: 'DELETE',
                    url: '/v1/nomodel/' + userId
                };
                server.inject(request, function (response) {

                    Code.expect(response.result.isBomm).to.be.true;
                    Code.expect(response.result.statusCode).to.be.equal(404);
                    return done();
                });
            });

            lab.test('`DELETE /users/{badId}`, it returns Boom object with statusCode 500', function (done) {

                var request = {
                    method: 'DELETE',
                    url: '/v1/users/' + adminId + 33
                };
                server.inject(request, function (response) {

                    Code.expect(response.result.isBomm).to.be.true;
                    Code.expect(response.result.statusCode).to.be.equal(500);
                    return done();
                });
            });

            lab.test('`DELETE /admins/{randomId}`, it returns Boom object with statusCode 404', function (done) {

                var request = {
                    method: 'DELETE',
                    url: '/v1/admins/' + Mongoose.Types.ObjectId()
                };
                server.inject(request, function (response) {

                    Code.expect(response.result.isBomm).to.be.true;
                    Code.expect(response.result.statusCode).to.be.equal(404);
                    return done();
                });
            });
        });

        lab.experiment('inject request `POST /admins`', function () {

            lab.test('with correct payload, it returns statusCode 200', function (done) {

                var request = {
                    method: 'POST',
                    url: '/v1/admins',
                    payload: {
                        admin: {
                            name: 'Luis',
                            age: 32
                        }
                    }
                };
                server.inject(request, function (response) {

                    Code.expect(response.statusCode).to.be.equal(200);
                    return done();
                });
            });

            lab.test('with not payload, it returns statusCode 200', function (done) {

                var request = {
                    method: 'POST',
                    url: '/v1/admins',
                    payload: null
                };
                server.inject(request, function (response) {

                    Code.expect(response.statusCode).to.be.equal(200);
                    return done();
                });
            });

            lab.test('with diferent payload, it returns statusCode 200', function (done) {

                var request = {
                    method: 'POST',
                    url: '/v1/admins',
                    payload: {
                        nomodel: {}
                    }
                };
                server.inject(request, function (response) {

                    Code.expect(response.statusCode).to.be.equal(200);
                    return done();
                });
            });
        });

        lab.test('inject request `POST /nomodel` it returns statusCode 404 (nomodel not exist)', function (done) {

            var request = {
                method: 'POST',
                url: '/v1/nomodel'
            };
            server.inject(request, function (response) {

                Code.expect(response.statusCode).to.be.equal(404);
                return done();
            });
        });

        lab.experiment('inject request `POST /users`', function () {

            lab.test('with correct payload, it returns statusCode 200, but call method touch', function (done) {

                var request = {
                    method: 'POST',
                    url: '/v1/users',
                    payload: {
                        user: {
                            username: 'other',
                            password: 'very secret'
                        }
                    }
                };
                server.inject(request, function (response) {

                    Code.expect(response.statusCode).to.be.equal(200);
                    return done();
                });
            });

            lab.test('with bad payload, it returns Boom object with statusCode 500', function (done) {

                var request = {
                    method: 'POST',
                    url: '/v1/users',
                    payload: {
                        user: {
                            password: 'very secret'
                        }
                    }
                };
                server.inject(request, function (response) {

                    Code.expect(response.result.isBomm).to.be.true;
                    Code.expect(response.statusCode).to.be.equal(500);
                    return done();
                });
            });
        });

        lab.experiment('inject request `PUT /admins/{adminId}`', function () {

            lab.test('with correct payload, it returns statusCode 200', function (done) {

                var request = {
                    method: 'PUT',
                    url: '/v1/admins/' + adminId,
                    payload: {
                        admin: {
                            name: 'New name'
                        }
                    }
                };
                server.inject(request, function (response) {

                    Code.expect(response.statusCode).to.be.equal(200);
                    return done();
                });
            });

            lab.test('with diferent payload, it returns statusCode 200', function (done) {

                var request = {
                    method: 'PUT',
                    url: '/v1/admins/' + adminId,
                    payload: {
                        nomodel: {}
                    }
                };
                server.inject(request, function (response) {

                    Code.expect(response.statusCode).to.be.equal(200);
                    return done();
                });
            });
        });

        lab.test('inject request `PUT /nomodel/{adminId}`, it returns statusCode 404 (nomodel not exist)', function (done) {

            var request = {
                method: 'PUT',
                url: '/v1/nomodel/' + adminId
            };
            server.inject(request, function (response) {

                Code.expect(response.statusCode).to.be.equal(404);
                return done();
            });
        });

        lab.test('inject request `PUT /admins/{badId}`, it returns statusCode 500', function (done) {

            var request = {
                method: 'PUT',
                url: '/v1/admins/' + adminId + 33
            };
            server.inject(request, function (response) {

                Code.expect(response.statusCode).to.be.equal(500);
                return done();
            });
        });

        lab.test('inject request `PUT /admins/{randomId}`, it returns statusCode 404', function (done) {

            var request = {
                method: 'PUT',
                url: '/v1/admins/' + Mongoose.Types.ObjectId()
            };
            server.inject(request, function (response) {

                Code.expect(response.statusCode).to.be.equal(404);
                return done();
            });
        });

        lab.test('inject request `PUT /userId/{userId}` with correct payload, it returns statusCode 404', function (done) {

            var request = {
                method: 'PUT',
                url: '/v1/users/' + userId,
                payload: {
                    username: 'new username'
                }
            };
            server.inject(request, function (response) {

                Code.expect(response.statusCode).to.be.equal(200);
                return done();
            });
        });

        lab.test('inject request `PUT /userId/{userId}` with bad payload, it returns statusCode 500', function (done) {

            var request = {
                method: 'PUT',
                url: '/v1/users/' + userId,
                payload: {
                    username: null
                }
            };
            server.inject(request, function (response) {

                Code.expect(response.statusCode).to.be.equal(500);
                return done();
            });
        });


        lab.after(function (done) {
            server.stop(function (err) {

                return done(err);
            });
        });
    });
});
