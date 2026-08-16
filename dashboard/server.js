const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.static(__dirname));

// Route Aliases
app.get("/voter", (req, res) => res.sendFile(path.join(__dirname, "voter.html")));
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "admin.html")));
app.get("/public", (req, res) => res.sendFile(path.join(__dirname, "public.html")));

app.use((req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`PQ-ZKVote Multi-Role Web Portal running on http://localhost:${PORT}`);
    });
}

module.exports = app;
