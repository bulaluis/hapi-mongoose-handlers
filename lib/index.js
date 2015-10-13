// Load modules

var Hoek = require('hoek');
var Joi = require('joi');
var Boom = require('boom');
var Lodash = require('lodash');
var Async = require('async');


// Declare internals

var internals = {
    schema: Joi.object({
        onCreate: Joi.string().valid('object', 'no-content').default('no-content'),
        onUpdate: Joi.string().valid('object', 'no-content').default('no-content'),
        onRemove: Joi.string().valid('object', 'no-content').default('no-content'),
        pagination: Joi.object({
            meta: Joi.string(),
            totalPages: Joi.string(),
            totalDocs: Joi.string(),
            defaultLimit: Joi.number()
        }).default({
            meta: 'meta',
            totalPages: 'totalPages',
            totalDocs: 'totalDocs',
            defaultLimit: 30
        }),

        // Custom handlers, if defined a function it's same like Hapi handlers,
        // else will apply a merge on defaults

        find: Joi.alternatives().try(Joi.func(), Joi.object()),
        create: Joi.alternatives().try(Joi.func(), Joi.object()),
        update: Joi.alternatives().try(Joi.func(), Joi.object()),
        remove: Joi.alternatives().try(Joi.func(), Joi.object()),

        where: Joi.boolean().default(false),        // At your own risk
    }),
    handlers: {}
};


exports.register = function (server, options, next) {

    var results = Joi.validate(options, internals.schema);
    Hoek.assert(!results.error, results.error);
    
    // Settings available in each handler   
    internals.settings = results.value;

    var handler;
    var customHandler;
    for (var key in internals.handlers) {
        handler = internals.handlers[key];
        customHandler = internals.settings[key];

        if (customHandler) {
            if (typeof(customHandler) === 'function') {
                handler = customHandler;
            }
            else {
                Hoek.merge(handler.defaults, customHandler);
            }
        }

        server.handler(key, handler);
    }

    return next();
};


exports.register.attributes = {
    pkg: require('../package.json')
};


internals.handlers.find = function (route, options) {

    var settings = internals.settings;
    return function (request, reply) {

        if (!request.Model) {
            return reply(Boom.notFound());
        }

        var Model = request.Model;
        Hoek.assert(Model.modelName, 'Model in route with path `' + request.path + '` it`s not valid: ' + Model);

        var query = request.params.id ? Model.findById(request.params.id) : Model.find(request.pre.conditions || {});
        var page = request.query.page;
        var limit = request.query.limit;

        // If the page was defined, force a limit data

        if (page) {
            if (!limit) {
                limit = settings.pagination.defaultLimit;
            }

            // http://mongoosejs.com/docs/api.html#query_Query-skip
            query.skip((page * limit) - limit);
        }

        // http://mongoosejs.com/docs/api.html#query_Query-limit
        if (limit) {
            query.limit(limit);
        }
        
        // http://mongoosejs.com/docs/api.html#query_Query-sort
        if (request.query.sort) {
            query.sort(request.query.sort);
        }
        
        // http://mongoosejs.com/docs/api.html#query_Query-where
        if (request.query.where && settings.where) {
            query.where(request.query.where);
        }

        // http://mongoosejs.com/docs/api.html#query_Query-populate
        if (request.query.populate) {
            query.populate(request.query.populate);
        }

        // http://mongoosejs.com/docs/api.html#query_Query-select
        if (request.query.select) {
            query.select(request.query.select);
        }

        // Search in each path (with type String) the regular expretion defined
        // in `search` query parameter

        if (request.query.search) {
            var search = request.query.search;
            var regExp = new RegExp(search, 'gi');
            var or = [];

            Model.schema.eachPath(function (path, schemaType) {
                if (schemaType.instance === 'String') {
                    or.push(Lodash.zipObject([path], [regExp]))
                }
            });

            query.or(or);
        }

        // Get total records (taking into account the conditions of the search)
        // and data to send to client
        
        Async.parallel({
            count: function (callback) {
                
                return Model.find(query._conditions).count(function (err, count) {
                    
                    return Hoek.nextTick(callback)(err, count);
                });
            },
            result: function (callback) {
                
                return query.exec(function (err, result) {

                    return Hoek.nextTick(callback)(err, result);
                });
            }
        }, function (err, data) {

            if (err) {
                return reply(err);
            }

            if (!data.result) {
                return reply(Boom.notFound());
            }

            Async.waterfall([
                function (callback) {

                    var deepPopulate = request.query.deepPopulate;
                    if (Lodash.isEmpty(deepPopulate)) {
                        return Hoek.nextTick(callback)(null, data.result);
                    }

                    // Deep polulate support

                    Async.reduce(deepPopulate, data.result, function (_docs, _deepPopulate, next) {
                        
                        Model.model(_deepPopulate.modelName).populate(data.result, _deepPopulate.populate, next);
                    }, function (err, docs) {

                        return Hoek.nextTick(callback)(err, docs);
                    });
                }
            ], function (err, docs) {

                var meta = Lodash.zipObject([settings.pagination.totalPages, settings.pagination.totalDocs], [Math.ceil(data.count / limit) || 1, data.count]);
                return reply(err, Lodash.zipObject([Model.modelName, settings.pagination.meta], [docs, meta]));
            });
        });
    };
};


internals.handlers.find.defaults = {
    validate: {
        params: Joi.object({
            id: Joi.string()
        }).unknown(true),
        query: Joi.object({
            page: Joi.number(),
            limit: Joi.number(),
            sort: Joi.alternatives().try(Joi.array(), Joi.string()),
            where: Joi.object(),
            search: Joi.string(),
            populate: Joi.alternatives().try(Joi.array(), Joi.string(), Joi.object()),
            deepPopulate: Joi.array().items(Joi.object({
                modelName: Joi.string(),
                populate: Joi.alternatives().try(Joi.array(), Joi.string(), Joi.object())
            })),
            select: Joi.alternatives().try(Joi.string(), Joi.object())
        }).with('deepPopulate', 'populate')          // To deepPopulate is required populate 
    }
};


exports.getPayload = function (request, modelName) {

    var payload = request.payload || {};
    if (payload.hasOwnProperty(modelName)) {
        payload = payload[modelName];
    }
    return payload;
};


internals.handlers.create = function (route, options) {

    var settings = internals.settings;
    return function (request, reply) {

        if (!request.Model) {
            return reply(Boom.notFound());
        }

        var Model = request.Model;
        Hoek.assert(Model.modelName, 'Model in route with path `' + request.path + '` it`s not valid: ' + Model);
        var doc = new Model(exports.getPayload(request, Model.modelName.toLowerCase()));

        // Support other features
        if (typeof doc.touch === 'function') {
            doc.touch(request.auth.credentials);
        }

        doc.save(function (err, doc) {

            var returnObject = settings.onCreate === 'object';
            return reply(err, returnObject ? Lodash.zipObject([Model.modelName], [doc]): null);
        });
    };
};


internals.handlers.create.defaults = {};


internals.handlers.update = function (route, options) {

    var settings = internals.settings;
    return function (request, reply) {

        if (!request.Model) {
            return reply(Boom.notFound());
        }

        var Model = request.Model;
        Hoek.assert(Model.modelName, 'Model in route with path `' + request.path + '` it`s not valid: ' + Model);
        
        Model.findById(request.params.id, function (err, doc) {

            if (err) {
                return reply(err);
            }

            if (!doc) {
                return reply(Boom.notFound());
            }

            doc.set(exports.getPayload(request, Model.modelName.toLowerCase()));
            
            // Support other features
            if (typeof doc.touch === 'function') {
                doc.touch(request.auth.credentials);
            }
            doc.save(function (err, doc) {

                var returnObject = settings.onUpdate === 'object';
                return reply(err, returnObject ? Lodash.zipObject([Model.modelName], [doc]): null);
            });
        });
    };
};


internals.handlers.update.defaults = {
    validate: {
        params: Joi.object({
            id: Joi.string().required()
        }).unknown(true),
    }   
};


internals.handlers.remove = function (route, options) {

    var settings = internals.settings;
    return function (request, reply) {

        if (!request.Model) {
            return reply(Boom.notFound());
        }

        var Model = request.Model;
        Hoek.assert(Model.modelName, 'Model in route with path `' + request.path + '` it`s not valid: ' + Model);
        
        Model.findById(request.params.id, function (err, doc) {

            if (err) {
                return reply(err);
            }

            if (!doc) {
                return reply(Boom.notFound());
            }

            doc.remove(function (err, doc) {

                var returnObject = settings.onRemove === 'object';
                return reply(err, returnObject ? Lodash.zipObject([Model.modelName], [doc]): null);
            });
        });
    };
};


internals.handlers.remove.defaults = {
    validate: {
        params: Joi.object({
            id: Joi.string().required()
        }).unknown(true),
    }   
};
