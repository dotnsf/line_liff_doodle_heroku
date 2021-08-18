//. app.js

var express = require( 'express' ),
    basicAuth = require( 'basic-auth-connect' ),
    multer = require( 'multer' ),
    bodyParser = require( 'body-parser' ),
    fs = require( 'fs' ),
    ejs = require( 'ejs' ),
    { v4: uuidv4 } = require( 'uuid' ),
    app = express();
var PG = require( 'pg' );
PG.defaults.ssl = true;


//. env values
var pg_hostname = 'PG_HOSTNAME' in process.env ? process.env.PG_HOSTNAME : ''; 
var pg_port = 'PG_PORT' in process.env ? parseInt( process.env.PG_PORT ) : 5432; 
var pg_database = 'PG_DATABASE' in process.env ? process.env.PG_DATABASE : ''; 
var pg_username = 'PG_USERNAME' in process.env ? process.env.PG_USERNAME : ''; 
var pg_password = 'PG_PASSWORD' in process.env ? process.env.PG_PASSWORD : ''; 
var settings_liff_id = 'LIFF_ID' in process.env ? process.env.LIFF_ID : ''; 

var basic_username = 'BASIC_USERNAME' in process.env ? process.env.BASIC_USERNAME : ''; 
var basic_password = 'BASIC_PASSWORD' in process.env ? process.env.BASIC_PASSWORD : ''; 

var pg_client = null;
if( pg_hostname && pg_port && pg_database && pg_username && pg_password ){
  var connectionString = "postgres://" + pg_username + ":" + pg_password + "@" + pg_hostname + ":" + pg_port + "/" + pg_database;
  var pg = new PG.Pool({ 
    connectionString: connectionString,
    idleTimeoutMillis: ( 30 * 86400 * 1000 )  //. 30 days : https://node-postgres.com/api/pool#new-pool-config-object-
  });
  pg.connect( function( err, client ){
    if( err ){
      console.log( err );
    }else{
      pg_client = client;
    }
  });
  pg.on( 'error', function( err ){
    console.error( 'on error', err );
    pg.connect( function( err, client ){
      if( err ){
        console.log( 'err', err );
      }else{
        pg_client = client;
      }
    });
  });
}


app.use( multer( { dest: './tmp/' } ).single( 'image' ) );
app.use( bodyParser.urlencoded( { extended: true } ) );
app.use( bodyParser.json() );
app.use( express.Router() );
app.use( express.static( __dirname + '/public' ) );

app.set( 'views', __dirname + '/public' );
app.set( 'view engine', 'ejs' );

app.get( '/', function( req, res ){
  res.render( 'index', { liff_id: settings_liff_id } );
});

app.post( '/image', async function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );

  var imgpath = req.file.path;
  var imgtype = req.file.mimetype;
  var filename = req.file.originalname;
  var user_id = req.body.user_id;

  var img = fs.readFileSync( imgpath );
  if( img && imgtype && filename && user_id ){
    var id = await createImage( img, imgtype, filename, user_id );
    if( id ){
      res.write( JSON.stringify( { status: true, id: id } ) );
      res.end();
    }else{
      res.status( 400 );
      res.write( JSON.stringify( { status: false } ) );
      res.end();
    }
  }else{
    res.status( 400 );
    res.write( JSON.stringify( { status: false, error: 'no image' } ) );
    res.end();
  }
});

app.get( '/image/:id', async function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );

  var id = req.params.id ? req.params.id : null;
  if( id ){
    var image = await readImage( id );
    if( image ){
      if( req.query.attachment ){
        res.contentType( image.contenttype );
        res.end( image.body, 'binary' );
      }else{
        res.write( JSON.stringify( { status: true, image: image } ) );
        res.end();
      }
    }else{
      res.status( 400 );
      res.write( JSON.stringify( { status: false } ) );
      res.end();
    }
  }else{
    res.status( 400 );
    res.write( JSON.stringify( { status: false, error: 'no id' } ) );
    res.end();
  }
  var id = req.params.id;
  var att = req.query.att ? req.query.att : 'image';
  db.attachment.get( image_id, att, function( err1, body1 ){
    res.contentType( 'image/png' );
    res.end( body1, 'binary' );
  });
});

app.delete( '/image/:id', async function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );

  var id = req.params.id ? req.params.id : null;
  if( id ){
    var r = await deleteImage( id );
    if( r ){
      res.write( JSON.stringify( { status: true } ) );
      res.end();
    }else{
      res.status( 400 );
      res.write( JSON.stringify( { status: false } ) );
      res.end();
    }
  }else{
    res.status( 400 );
    res.write( JSON.stringify( { status: false, error: 'no id' } ) );
    res.end();
  }
});


app.get( '/images', async function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );

  var limit = req.query.limit ? parseInt( req.query.limit ) : 0;
  var start = req.query.start ? parseInt( req.query.start ) : 0;
  var images = await readImages( limit, start );
  if( images ){
    res.write( JSON.stringify( { status: true, images: images } ) );
    res.end();
  }else{
    res.status( 400 );
    res.write( JSON.stringify( { status: false } ) );
    res.end();
  }
});

app.get( '/images/:user_id', async function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );

  var user_id = req.params.user_id;
  var limit = req.query.limit ? parseInt( req.query.limit ) : 0;
  var start = req.query.start ? parseInt( req.query.start ) : 0;
  var images = await readImagesByUserId( user_id, limit, start );
  if( images ){
    res.write( JSON.stringify( { status: true, images: images } ) );
    res.end();
  }else{
    res.status( 400 );
    res.write( JSON.stringify( { status: false } ) );
    res.end();
  }
});


//. CREATE IMAGE
createImage = async function( body, contenttype, filename, user_id ){
  return new Promise( async ( resolve, reject ) => {
    var id = uuidv4();
    var ts = ( new Date() ).getTime();
    var sql = "insert into images( id, body, contenttype, filename, user_id, created, updated ) values( $1, $2, $3, $4, $5, $6, $7 )";
    var query = { text: sql, values: [ id, body, contenttype, filename, user_id, ts, ts ] };

    pg_client.query( query, function( err, result ){
      if( err ){
        console.log( err );
        resolve( null );
      }else{
        resolve( id );
      }
    });
  });
};

//. READ IMAGE
readImage = async function( id ){
  return new Promise( async ( resolve, reject ) => {
    var sql = "select * from images where id = $1";
    var query = { text: sql, values: [ id ] };

    pg_client.query( query, function( err, result ){
      if( err ){
        console.log( err );
        resolve( null );
      }else{
        var image = null;
        if( result.rows.length > 0 && result.rows[0].id ){
          try{
            image = result.rows[0];
          }catch( e ){
          }
        }
        resolve( image );
      }
    });
  });
};

//. READ IMAGES
readImages = async function( limit, start ){
  return new Promise( async ( resolve, reject ) => {
    var sql = "select * from images order by created";
    if( limit ){
      sql += ' limit ' + limit;
    }
    if( start ){
      sql += ' start ' + start;
    }
    var query = { text: sql, values: [] };

    pg_client.query( query, function( err, result ){
      if( err ){
        console.log( err );
        resolve( null );
      }else{
        var images = [];
        if( result.rows.length > 0 ){
          try{
            images = result.rows;
          }catch( e ){
          }
        }
        resolve( images );
      }
    });
  });
};

//. READ IMAGES
readImagesByUserId = async function( user_id, limit, start ){
  return new Promise( async ( resolve, reject ) => {
    var sql = "select * from images where user_id = $1 order by created";
    if( limit ){
      sql += ' limit ' + limit;
    }
    if( start ){
      sql += ' start ' + start;
    }
    var query = { text: sql, values: [ user_id ] };

    pg_client.query( query, function( err, result ){
      if( err ){
        console.log( err );
        resolve( null );
      }else{
        var images = [];
        if( result.rows.length > 0 ){
          try{
            images = result.rows;
          }catch( e ){
          }
        }
        resolve( images );
      }
    });
  });
};

//. DELETE IMAGE
deleteImage = async function( id ){
  return new Promise( async ( resolve, reject ) => {
    var sql = "delete from images where id = $1";
    var query = { text: sql, values: [ id ] };

    pg_client.query( query, function( err, result ){
      if( err ){
        console.log( err );
        reject( err );
      }else{
        resolve( true );
      }
    });
  });
};


function timestamp2datetime( ts ){
  if( ts ){
    var dt = new Date( ts );
    var yyyy = dt.getFullYear();
    var mm = dt.getMonth() + 1;
    var dd = dt.getDate();
    var hh = dt.getHours();
    var nn = dt.getMinutes();
    var ss = dt.getSeconds();
    var datetime = yyyy + '-' + ( mm < 10 ? '0' : '' ) + mm + '-' + ( dd < 10 ? '0' : '' ) + dd
      + ' ' + ( hh < 10 ? '0' : '' ) + hh + ':' + ( nn < 10 ? '0' : '' ) + nn + ':' + ( ss < 10 ? '0' : '' ) + ss;
    return datetime;
  }else{
    return "";
  }
}

function compareByTimestamp( a, b ){
  var r = 0;
  if( a.timestamp < b.timestamp ){ r = -1; }
  else if( a.timestamp < b.timestamp ){ r = 1; }

  return r;
}


var port = process.env.port || 8080;
app.listen( port );
console.log( "server stating on " + port + " ..." );
