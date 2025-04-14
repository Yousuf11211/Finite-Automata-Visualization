# Finite Automata Visualization

## Overview

This project is a web-based tool for creating, visualizing, and simulating finite automata. It provides an interactive interface for users to design Deterministic Finite Automata (DFA) and Nondeterministic Finite Automata (NFA), simulate their behavior, and convert between representations.

---

## Features

- **Interactive Graphical Interface**:
  - Add, delete, and modify states and transitions.
  - Set initial and final states with intuitive controls.
  - Visualize automata on a canvas using the Pixi.js library.

- **Simulation**:
  - Step-by-step simulation of automata on input strings.
  - Visual feedback for state transitions and acceptance.

- **Conversion**:
  - Convert NFA to DFA using the powerset construction algorithm.
  - Generate regular expressions from NFAs.

- **Modes**:
  - **Button Mode**: Use buttons to interactively create automata.
  - **Code Mode**: Manually define automata using code.

- **Dark Theme**:
  - A visually appealing dark theme for reduced eye strain.

---

## Project Structure

---

## How to Use

### **Button Mode**
1. Open `button_input.html` in a browser.
2. Use the following controls:
   - **Add State**: Adds a new state to the canvas.
   - **Add Transition**: Creates a transition between two states.
   - **Delete Selected**: Deletes the selected state or transition.
   - **Initial**: Sets a state as the initial state.
   - **Final**: Marks a state as an accepting (final) state.
   - **Simulate**: Simulates the automaton on an input string.

### **Code Mode**
1. Open the manual input interface (linked from the Button Mode).
2. Define automata using code or load sample automata definitions.
3. Run simulations or convert between representations.

---

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/your-repo/finite-automata-visualization.git

2. Open button_input.html in any modern browser.

## Dependencies
1. Pixi.js: A 2D rendering library for drawing the automata.
2. JavaScript: Core logic for automata creation and simulation.

## Future Enhancements
1. Add support for exporting and importing automata definitions.
2. Improve the user interface for better usability.
3. Add more algorithms, such as minimization of DFAs.

## Developers
 Yousuf
