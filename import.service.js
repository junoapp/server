const Pool = require('pg').Pool;
const fastcsv = require('fast-csv');
const fs = require('fs');

// Create a connection to the database
const pool = new Pool({
  host: 'localhost',
  user: 'pricing',
  database: 'juno',
  password: 'test',
  port: 5432,
  schema: 'cases',
});

// var db = new Pg.Client({
//   host: 'localhost',
//   user: 'pricing',
//   database: 'juno',
//   password: 'test',
//   port: 5432,
// });

// db.connect((err) => {
//   console.log(err);

//   Ddl.postgresql(db, 'cases.public_cases', function (err, ddl) {
//     console.log(err, ddl);
//   });
// });

// open the PostgreSQL connection
pool.connect((err, client, done) => {
  if (err) throw err;

  const schema = 'cases';
  const table = 'public_cases';

  client.query(`select * from ${schema}.${table}`, (err, res) => {
    const ws = fs.createWriteStream(`${table}.csv`);

    if (err) {
      console.log(err.stack);
    } else {
      const jsonData = JSON.parse(JSON.stringify(res.rows));

      fastcsv
        .write(jsonData, { headers: true })
        .on('finish', function () {
          console.log('Write to bezkoder_postgresql_fastcsv.csv successfully!');
        })
        .pipe(ws);

      client.query(
        `
          SELECT
              tc.table_schema, 
              tc.constraint_name, 
              tc.table_name, 
              kcu.column_name, 
              ccu.table_schema AS foreign_table_schema,
              ccu.table_name AS foreign_table_name,
              ccu.column_name AS foreign_column_name 
          FROM 
              information_schema.table_constraints AS tc 
              JOIN information_schema.key_column_usage AS kcu
                ON tc.constraint_name = kcu.constraint_name
                AND tc.table_schema = kcu.table_schema
              JOIN information_schema.constraint_column_usage AS ccu
                ON ccu.constraint_name = tc.constraint_name
                AND ccu.table_schema = tc.table_schema
          WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = '${schema}' AND tc.table_name = '${table}'`,
        (err1, res1) => {
          const jsonData = JSON.parse(JSON.stringify(res1.rows));

          for (const row of jsonData) {
            client.query(`select * from ${row.foreign_table_schema}.${row.foreign_table_name}`, (err2, res2) => {
              const ws2 = fs.createWriteStream(`${row.foreign_table_name}.csv`);

              const jsonData2 = JSON.parse(JSON.stringify(res2.rows));

              fastcsv
                .write(jsonData2, { headers: true })
                .on('finish', function () {
                  console.log('Write to bezkoder_postgresql_fastcsv.csv successfully!');
                })
                .pipe(ws2);
            });
          }
          done();
        }
      );
    }
  });
});
