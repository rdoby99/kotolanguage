const express = require("express");
const cors = require("cors");
const MeCab = require("mecab-async");
const { Pool } = require("pg");
const dotenv = require("dotenv");
const bodyParser = require("body-parser");
const path = require("path");
const { createObjectCsvStringifier } = require("csv-writer");
const OpenAI = require("openai");

// Load environment variables from .env file
dotenv.config();

const app = express();
app.use(cors());
app.use(bodyParser.json());

const mecab = new MeCab();
const pool = new Pool({
  user: process.env.DB_USER,
  host: "localhost",
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
});

app.get("/words", async (req, res) => {
  try {
    // Parse using Mecab
    const text = req.query.text;
    mecab.parse(text, async (err, result) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      const words = result
        .map((node) => node[0])
        .filter((word) => word !== "EOS");

      if (!words.length) {
        return res.json({ results: [] });
      }

      // Query database
      const query = `
      SELECT * FROM words 
      WHERE (kanji && $1::text[]) 
        OR ((kanji IS NULL OR array_length(kanji, 1) = 0) AND reading && $1::text[]) 
      `;

      try {
        const client = await pool.connect();
        const { rows } = await client.query(query, [words]);
        client.release();

        // Sends JSON response to client
        // const dataRes = res.json({ results: rows });

        const dataRes = rows;
        console.log(dataRes);

        try {
          const openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
          });
          // AI request
          const response1 = await openai.chat.completions.create({
            messages: [
              {
                role: "system",
                content:
                  "I am going to send you three mesages back to back. The first is a string of Japanese text. The second contains an array of words we'd like to translate. The third is an array of objects with possible definitions for the words in the text. The objects include keys for id, kanji, reading, and definition. Based on the string of Japanese text do two things. 1) Remove any duplicates from the object and keep only the object relvant to the text. Duplicates can be one of two things. Duplicates of type one are objects where the kanji property is the same. Duplicates of type two are objects where the reading is the same, given the kanji value in the object is empty. 2) Return a new array of selected objects from the array of objects in the thrid message. Ensure the definition value is an array of gloss objects. Each gloss object has one array. Kanji and reading should be arrays of strings. Only return an array of objects, no extra text. Make sure each word in the second message has an accosiated object.",
              },
              {
                role: "user",
                content: text,
              },
              {
                role: "user",
                content: `${words}`,
              },
              {
                role: "user",
                content: `${dataRes}`,
              },
            ],
            model: "gpt-4o-mini",
          });

          // console.log(response1.choices[0]);
          return res.json(response1.choices[0].message.content);
        } catch (err) {
          console.error(`Error using AI API: ${err}`);
          return res.status(500).json({ error: err });
        }
      } catch (err) {
        console.error(`Error querying database: ${err}`);
        return res.status(500).json({ error: err });
      }
    });
  } catch (err) {
    console.error(`Error parsing text: ${err}`);
    return res.status(500).json({ error: err.message });
  }
});

// Download selected rows from front end
app.post("/csv", async (req, res) => {
  const data = req.body.data;

  const csvStringifier = createObjectCsvStringifier({
    header: [
      { id: "front", title: "FRONT" },
      { id: "back", title: "BACK" },
    ],
  });

  try {
    const header = csvStringifier.getHeaderString();
    const records = csvStringifier.stringifyRecords(data);

    const csvContent = header + records;

    // Set headers to force download
    res.setHeader("Content-Disposition", "attachment; filename=output.csv");
    res.setHeader("Content-Type", "text/csv");

    // Send CSV content as a response
    res.send(csvContent);
  } catch (err) {
    console.error(`Error: ${err}`);
    return res.status(500).json({ error: err.message });
  }
});

const port = 5001;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
