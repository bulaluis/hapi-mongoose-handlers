# hapi-mongoose-handlers

REST handlers for models created in mongoose

## Install

```bash
$ npm install hapi-mongoose-handlers
```

## Usage

```javascript
var Hapi = require('hapi');
var server = new Hapi.Server();
server.connection({ port: 8000 });

server.register([{
        register: require('hapi-mongoose-connect'),
        options: {
            uri: 'mongodb://localhost/my-database'
        }
    }, {
        register: require('hapi-mongoose-models'),
        options: {
            pattern: './models/**/*.js',
            options: {
                cwd: __dirname
            }
        }
    }, {
        register: require('hapi-mongoose-request'),
        options: {
            param: 'model',
            capitalize: true,
            singularize: true
        }
    }, {
        register: require('hapi-mongoose-handlers'),
        options: {
            find: function (route, options) {},     // Custom handler
            pagination: {                               // Can personalize all response information
                meta: 'meta',
                totalPages: 'count'                 
            },
            onCreate: 'object',                     // Determine what information will return
            onRemove: 'no-content',
            where: true                             // Can activate advanced searches (be careful with this)
        }   
    }], function (err) {

        if (err) {
            throw err;
        }
        
        server.route({
            method: 'GET',
            path: '/api/{model}/{id?}'       // hapi-mongoose-request Plugin is almost necessary
            handler: {
                find: {}
            }
        });
        
        // Now can visit `/{yourmodel}/{id?}

        server.start(function (err) {

            if (err) {
                throw err;
            }
            console.log('Server started at: ' + server.info.uri);
        });
    }
});
```

## Tests
Run comand `make test` or `npm test`. Include 100% test coverage.

# License
MIT