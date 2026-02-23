---
layout: post
title: "AI Build Journal: Claude Opus 4.6 on a Simple iOS Card UI"
date: 2026-02-23 00:00:00
categories: ai ios
tags: [ai, ios, swiftui, react-native, ux]
published: false
publish_window_start: 2026-04-23
publish_window_end: 2026-06-23
---

## Entry Date: February 23, 2026

Today I tested Claude Opus 4.6 on a simple iOS frontend task: a flippable card UI.

I built two versions:
- a React Native version
- a Swift version

The React Native version basically got it right in one go.

The Swift version did not. UI polish was noticeably off: text overlaps, inconsistent spacing, and a mix of too much empty space in some areas while feeling crowded in others.

I did 5-6 feedback round trips with screenshots and concrete fix requests for the Swift version. Claude Opus 4.6 still failed to get the Swift UI/UX to an acceptable level.

Takeaway for now: for this specific task and this session, React Native output quality was significantly better than Swift output quality.

![React Native vs Swift output comparison](/assets/img/ai-journal-2026-02-23-compare.png)
