# Mochi 2048

Static 2048 game with autosave, undo, board-size switching, and a Firebase Firestore leaderboard.

Open `index.html` in a browser to play.

Firebase setup:
- Create a Firestore database in the `mochi-2048` Firebase project.
- The game stores scores in collections named `leaderboard_4x4`, `leaderboard_5x5`, and `leaderboard_6x6`.
- If your browser blocks module imports from `file://`, run the folder with a simple local server or VS Code Live Server.
