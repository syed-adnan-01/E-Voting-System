const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.static(__dirname));

app.use((req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Live Election & Anomaly Dashboard running on http://localhost:${PORT}`);
    });
}

module.exports = app;
