---
title: "How it Works"
description: "A deep dive into how Semper captures and indexes your Mac's memory."
pubDate: 2026-05-13
author: "Semper Team"
---

Semper follows your work at the context level: screen text, app identity, timestamps, and the trail you need when you are trying to pick something back up.

---

### Capture
Semper uses apple accessibility apis and apple vision to capture text, images and other elements on your screen.

### Store
Semper stores all data locally on your mac with SQLite.

### Index
Semper indexes all data in a way that it can be searched quickly.

### Search
Semper runs local models like Gemma 4 on apple MLX to understand context, search timeline, and automate tasks.

All processing happens on device. Your data never leaves your mac.