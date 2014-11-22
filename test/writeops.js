//
//  Integration, not so much module tests here -
// it is important to assure if the stream works in intended environment.
//

'use strict';

var testable  = require('..')
  , stream    = require('stream')
  , mongodb   = require('mongodb')
  , should    = require('should')
  , source    = require('./stubs/source.js')

  , mongoPath = 'mongodb://localhost:27017'
  , collName  = 'tmp_bulk_mongo_test'
  , factory
  , db
  , coll
  , nInserts, nInserted
  ;

tests_write('bulk-writing');
tests_write('non-bulk-writing', {bulkSize: 0});
tests_pipe('bulk-piping');
tests_pipe('non-bulk-piping', {bulkSize: 0});

function db_close() {
  if (db) {
    db.close();
    db = null;
  }
}

function db_clean(cb) {
  db.dropCollection(collName, function (e) {
    db_close();
    cb(); // Ignore 'ns not found' error if collection did not exist
  });
}

function do_before(cb) {
  mongodb.MongoClient.connect(mongoPath, function (e, d) {
    if (! e) {
      db = d;
      coll = db.collection(collName);
      factory = testable(db);
    }
    cb(e);
  });
}

function do_after(cb) {
  if (! db) {
    mongodb.MongoClient.connect(mongoPath, function (e, d) {
      if (! e) {
        db = d;
        return db_clean(cb);
      }
      cb(e);
    });
    return;
  }
  db_clean(cb);
}

function makeDst(coll, options) {
  var dst = factory(coll, options);
  dst.on('inserts', function (d) {
    nInserts += 1;
    nInserted += d.nInserted;
  });
  nInserts = nInserted = 0;
  return dst;
}

function tests_write(label, options) {

  describe(label, function () {

    var dst, bulkMode = ! options || ! (options.bulkSize <= 1);

    before(do_before);
    after(do_after);

    it('factory should be a function', function () {
      factory.should.be.type('function');
    });

    it('dst should be a writable stream', function () {
      dst = makeDst(collName, options);
      dst.should.be.instanceof(stream.Writable);
    });

    it('should receive objects', function () {
      dst.write({data: 1});
      dst.write({data: 2});
    });

    if (bulkMode) {
      it('... but should not have written any yet', function (done) {
        var coll = db.collection(collName);
        coll.stats(function (err, stats) {
          if (err) {
            return done(err.errmsg.indexOf('not found.') > 0 ? null : err);
          }
          stats.count.should.be.equal(0);
          nInserted.should.be.equal(0);
          done();
        });
      });
    }

    it('should end normally', function (done) {
      //  This is somewhat ugly hack here -
      // end() will actually emit 'finish', which, in turn will
      // launch asynchronous execution of bulk operation...
      dst.end(function () {setTimeout(done, 50);});
    });

    it('... and have written all the data out', function (done) {
      coll.stats(function (err, stats) {
        if (! err) {
          stats.count.should.be.equal(2);
          nInserts.should.be.equal(bulkMode ? 1 : 0);
          nInserted.should.be.equal(bulkMode ? 2 : 0);
        }
        done(err);
      });
    });
  });

}

function tests_pipe(label, options) {

  describe(label, function () {

    var src, dst, bulkMode = ! options || ! (options.bulkSize <= 1);

    before(do_before);
    after(do_after);

    it('short pipe should work', function (done) {
      var err = null;
      dst = makeDst(coll, options);
      src = source(10);
      dst.on('finish', function () {
        setTimeout(function () {
          nInserted.should.be.equal(bulkMode ? 10 : 0);
          done(err);
        }, 10);
      });
      src.on('end', function () {dst.end();});
      src.pipe(dst);
    });

    it('... and should have written 10 records',
       function (done) {
         coll.stats(function (err, stats) {
           if (! err) {
             stats.count.should.be.equal(10);
           }
           done(err);
         });
       });

    it('long pipe should work', function (done) {
      dst = makeDst(coll, options);
      src = source(1555);
      dst.on('finish', function () {
        setTimeout(done, 50);
      });
      dst.on('error', function (e) {done(e);});
      src.pipe(dst);
    });

    it('... and have written 1555 more records', function (done) {
      coll.stats(function (err, stats) {
        if (! err) {
          stats.count.should.be.equal(10 + 1555);
          nInserted.should.be.equal(bulkMode ? 1555 : 0);
          nInserts.should.be.equal(bulkMode ? 2 : 0);
        }
        done(err);
      });
    });
  });
}

