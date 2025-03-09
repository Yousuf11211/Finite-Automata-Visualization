
// This software uses the pixi.js graphics library, which is
// licensed under the MIT License.
// See http://www.opensource.org/licenses/mit-license for details.

// Application constants

const STATE_RADIUS = 30;
const FOCUS_COLOR = 0x0000DD;

var workingGraph = null;

var workingAutomaton = null;

var regexParser = new RegexParser();

var psConstructor = new PSConstructor();

// Initialisation

let app = new PIXI.Application({
    width: 1024,
    height: 576,
    backgroundColor: 0xfdf0ce,
    resolution: window.devicePixelRatio || 1,
    antialias: true,
    autoDensity: true,
});
document.getElementById('app-position').appendChild(app.view);

// Font objects

const cmodern = new PIXI.TextStyle({
    fontFamily: 'serif',
    //fontStyle: 'italic',
    fontSize: 24
});

const logoFont = new PIXI.TextStyle({
    fontFamily: 'serif',
    fontStyle: 'italic',
    fontSize: 36,
    fill: 0x0000bb
});

const acceptFont = new PIXI.TextStyle({
    fontFamily: 'serif',
    fontStyle: 'italic',
    fontSize: 24,
    fill: 0x00bb00
});

/**
 * Deep copies a Graph object by value.
 * 
 * @param {Graph} oldGraph
 * @returns {Graph} newGraph
 **/
function copyGraph(oldGraph) {
    let newGraph = new Graph();
    let stateMap = new Map();
    for (const state of oldGraph.states) {
        stateMap.set(state, newGraph.addState(state.label.text, state.graphics.x, state.graphics.y));
        if (state.accepting) newGraph.makeAccepting(stateMap.get(state));
    }
    for (const arrow of oldGraph.transitions) {
        newGraph.addArrow(
            stateMap.get(arrow.fromState),
            stateMap.get(arrow.toState),
            arrow.label.text,
            arrow.loop,
            arrow.initial
        );
    }
    if (oldGraph.initialArrow) {
        newGraph.addArrow(
            stateMap.get(oldGraph.initialArrow.fromState),
            stateMap.get(oldGraph.initialArrow.toState),
            oldGraph.initialArrow.label.text,
            false,
            true
        );
    }
    delete stateMap;
    stateMap = null;
    return newGraph;
}

/**
 * Converts a Graph representing an NFA into its
 * corresponding regular expression by the state-replacement
 * generalised NFA method. Doing so alters the graph such that
 * it cannot be simulated correctly, but this can be avoided
 * by deep copying first using copyGraph().
 * 
 * @param {Graph} nfa
 * @returns {string} the equivalent regular expression
 **/
function nfaToRegex(nfa) {
    // This algorithm uses Arrow.label.text to store the regular
    // expressions generated. This creates an NFA that cannot be
    // simulated in Simulate mode, but exploits the structure of
    // the Graph object.
    if (nfa.acceptingStates.length == 0) {
        alert("Warning - NFA has no accepting states");
        return '';
    }
    if (nfa.initialArrow == null) {
        alert("Warning - NFA has no initial state");
        return '';
    }
    let originalStates = [...nfa.states];

    let start = nfa.addState("start", 100, 288);
    let end = nfa.addState("end", 924, 288);

    let lastArrow = null;

    // Construct singular initial and accepting states required
    nfa.addArrow(start, nfa.initialState, '$', false, false);
    nfa.addArrow(start, start, '$', false, true);
    for (const state of nfa.acceptingStates) {
        nfa.addArrow(state, end, '$', false, false);
        nfa.removeAcception(state);
    }
    nfa.makeAccepting(end);

    // Turn multisymbol arrow into single union regex
    for (const arrow of nfa.transitions) {
        if (arrow.symbols.size > 1) {
            arrow.updateLabel("(" + [...arrow.symbols].join("|") + ")");
        }
    }

    for (const state of originalStates) {
        let connectedArrows = nfa.getConnectedArrows(state);
        let toArrows = [];
        let fromArrows = [];
        let selfLoop = false;
        for (const arrow of connectedArrows) {
            // Divide connected arrows into those into the state and those from the state
            if (arrow.initial) continue;
            if (arrow.toState == state && !arrow.loop) toArrows.push(arrow);
            if (arrow.fromState == state && !arrow.loop) fromArrows.push(arrow);
            if (arrow.loop) selfLoop = arrow;
        }
        // For each pair of arrows (A,B) going to and from a state...
        for (const A of toArrows) {
            for (const B of fromArrows) {
                let strToAdd = '';
                // If state has a loop arrow, assemble regex like A(loop)*B
                if (selfLoop) {
                    if (selfLoop.label.text.length > 1) selfLoop.label.text = "(" + selfLoop.label.text + ")";
                    strToAdd = (A.label.text != '$' ? A.label.text : '')
                        + (selfLoop.label.text != '$' ? selfLoop.label.text + "*" : '')
                        + (B.label.text != '$' ? B.label.text : '');
                    // Otherwise assemble regex like AB
                } else {
                    strToAdd = (A.label.text != '$' ? A.label.text : '')
                        + (B.label.text != '$' ? B.label.text : '');
                }
                // Handle cases where arrow labels are blank as empty string regex
                if (strToAdd == '') strToAdd = '$';
                if (strToAdd == '*') strToAdd = '$*';
                // Finally add the bypassing arrow to the graph
                lastArrow = nfa.addArrow(
                    A.fromState,
                    B.toState,
                    strToAdd,
                    (A.fromState == B.toState),
                    false
                );
            }
        }
        nfa.removeState(state);
        for (const arrow of nfa.transitions) {
            // Turn multisymbol arrows into single union regexes
            if (arrow.symbols.size > 1) {
                arrow.updateLabel("(" + [...arrow.symbols].join("|") + ")");
            }
        }
    }
    if (nfa.transitions.length == 1) { // Only single initial and accepting states remain
        return lastArrow.label.text;
    } else {
        alert("Error while converting - Failed to condense to one transition.");
    }
}

// Regex parsing prototypes

/**
 * Create a new RegexParser object.
 * 
 * @returns the new RegexParser object
 */
function RegexParser() {
    this.order = {
        '*': 0,
        '.': 1,
        '|': 2
    };
    this.operators = ['*', '.', '|'];
    this.noncats = ['|', '*', '.'];

    return this;
}

/**
 * Turns an infix regex into a postfix array of
 * symbols and operators using the Shunting Yard algorithm.
 * 
 * @param {string} string
 * @returns {Array} the input regex as a postfix ordered array
 **/
RegexParser.prototype.shuntingYard = function (string) {
    let inputQueue = [...string];
    let opStack = [];
    let outputQueue = [];
    while (inputQueue.length > 0) {
        let token = inputQueue.shift();
        if (token == '!') {
            token = '$';
        }

        if (this.operators.includes(token)) {
            while (this.order[opStack[opStack.length - 1]] <= this.order[token] && opStack.length > 0) {
                outputQueue.push(opStack.pop());
            }
            opStack.push(token);
        } else if (token === '(') {
            opStack.push(token);
        } else if (token === ')') {
            while (opStack[opStack.length - 1] !== '(') {
                outputQueue.push(opStack.pop());
                if (opStack.length == 0) {
                    alert("Expression failed to parse - unbalanced parentheses");
                    throw "Failed parsing - unbalanced parentheses";
                    return null;
                }
            }
            opStack.pop();
        } else {
            outputQueue.push(token);
        }
    }
    if (opStack.includes('(')) {
        alert("Expression failed to parse - unbalanced parentheses");
        throw "Failed parsing - unbalanced parentheses";
        return null;
    }
    while (opStack.length > 0) {
        outputQueue.push(opStack.pop());
    }
    return outputQueue;
}

/**
 * Adds the concatenation symbol . to a regex string that
 * doesn't have any in the appropriate locations.
 * 
 * @param {string} string
 * @returns {string} the input string with concatenation symbols added
 **/
RegexParser.prototype.addConcatenations = function (string) {
    let input = [...string];
    let output = '';
    let lastChar = '|';
    while (input.length > 0) {
        if (lastChar == '(') {
            ;
        } else if (input[0] == ')') {
            ;
        } else if (lastChar == '*' && !this.noncats.includes(input[0])) {
            output = output + '.';
        } else if (!this.noncats.includes(lastChar) && !this.noncats.includes(input[0])) {
            output = output + '.';
        }
        lastChar = input.shift();
        output = output + lastChar;
    }
    return output;
}

/**
 * Converts a regular expression into a Graph object representing
 * an NFA by the Thompson construction.
 * 
 * @param {string} regex
 * @returns {Graph} a Graph object equivalent to the input regex
 **/
RegexParser.prototype.thompson = function (regex) {
    let postfix = this.shuntingYard(this.addConcatenations(regex));
    let stateCount = 0;

    var newGraph = new Graph();

    // Rules of Thompson's construction as functions.
    // Notation according to Aho et al. (2007).
    function symbol(a) {
        let from = newGraph.addState(stateCount++, 50 + Math.random() * 900, 50 + Math.random() * 400);
        let to = newGraph.addState(stateCount++, 50 + Math.random() * 900, 50 + Math.random() * 400);
        let arrow = newGraph.addArrow(from, to, a, false, false);
        return { first: from, last: to };
    }

    function union(ns, nt) {
        let from = newGraph.addState(stateCount++, 50 + Math.random() * 900, 50 + Math.random() * 400);
        let to = newGraph.addState(stateCount++, 50 + Math.random() * 900, 50 + Math.random() * 400);

        newGraph.addArrow(from, ns.first, '$', false, false);
        newGraph.addArrow(from, nt.first, '$', false, false);

        newGraph.addArrow(ns.last, to, '$', false, false);
        newGraph.addArrow(nt.last, to, '$', false, false);
        return { first: from, last: to };
    }

    function concatenation(ns, nt) {
        let from = ns.last;
        let to = nt.first;

        let label = '{' + from.label.text + ',' + to.label.text + '}';
        let concatState = newGraph.addState(label, 50 + Math.random() * 900, 50 + Math.random() * 400);

        for (const arrow of newGraph.transitions) {
            if (arrow.toState == from) {
                arrow.toState = concatState;
            }
            if (arrow.fromState == to) {
                arrow.fromState = concatState;
            }
        }
        newGraph.removeState(ns.last);
        newGraph.removeState(nt.first);
        return { first: ns.first, last: nt.last };
    }

    function kleene(ns) {
        let from = newGraph.addState(stateCount++, 50 + Math.random() * 900, 50 + Math.random() * 400);
        let to = newGraph.addState(stateCount++, 50 + Math.random() * 900, 50 + Math.random() * 400);

        newGraph.addArrow(from, ns.first, '$', false, false);
        newGraph.addArrow(ns.last, to, '$', false, false);

        newGraph.addArrow(ns.last, ns.first, '$', false, false);
        newGraph.addArrow(from, to, '$', false, false);

        return { first: from, last: to };
    }

    procStack = [];

    let op1, op2 = null;
    for (const token of [...postfix]) {
        switch (token) {
            case '|':
                op1 = procStack.pop();
                op2 = procStack.pop();
                if (op1 === undefined || op2 === undefined) {
                    alert("Error processing regex - Not enough operands for |.");
                    newGraph.selfDestruct();
                    return null;
                }
                procStack.push(union(op2, op1));
                break;
            case '.':
                op1 = procStack.pop();
                op2 = procStack.pop();
                if (op1 === undefined || op2 === undefined) {
                    alert("Error processing regex - Not enough operands for concatenation.");
                    newGraph.selfDestruct();
                    return null;
                }
                procStack.push(concatenation(op2, op1));
                break;
            case '*':
                op1 = procStack.pop();
                if (op1 === undefined) {
                    alert("Error processing regex - Not enough operands for *.");
                    newGraph.selfDestruct();
                    return null;
                }
                procStack.push(kleene(op1));
                break;
            default:
                procStack.push(symbol(token));
        }
    }
    if (procStack.length == 1) {
        newGraph.addArrow(procStack[0].first, procStack[0].first, '$', false, true);
        newGraph.makeAccepting(procStack[0].last);
        procStack[0].first.position(100, 288);
        procStack[0].last.position(924, 288);
    }
    return newGraph;
}

/**
 * Calculates the epsilon closure E(R) of a set of states R
 * from an input e-NFA. If the states array has only one element,
 * it is the epsilon closure E(q) of q.
 * 
 * @param {FA} nfa
 * @param states
 * @returns {Set} the epsilon closure of the input set of states
 **/
function epsilonClosure(nfa, states) {
    var closure = new Set();
    states.forEach(item => closure.add(item));
    var stateStack = [...states];

    let ep = nfa.sigma.indexOf('$');
    if (ep == -1) return closure; // No epsilon in alphabet - epsilon closure is trivial

    while (stateStack.length > 0) {
        let s = stateStack.pop();
        let i = nfa.q.indexOf(s);
        let transition = nfa.delta[i][ep];
        for (let k = 0; k < transition.length; k++) {
            if (transition[k] instanceof Arrow) {
                if (!(closure.has(transition[k].toState))) {
                    stateStack.push(transition[k].toState);
                    closure.add(transition[k].toState);
                }
            }
        }
    }
    return closure;
}

// Powerset construction functions

/**
 * Create a new PSConstructor powerset constructor object.
 * @returns the new PSConstructor object
 */
function PSConstructor() {
    return this;
}

/**
 * Calculates the union across r in the stateSet R of all
 * the transitions in the input e-NFA from r given a symbol
 * in the NFA's alphabet. Returns the set of states corresponding
 * to those transitions.
 * 
 * @param {FA} nfa
 * @param {Set} stateSet
 * @param symbol
 * @returns {Set} the set of states yielded by the input states and input symbol
 **/
PSConstructor.prototype.deltaGivenR = function (nfa, stateSet, symbol) {
    let next = new Set();
    let j = nfa.sigma.indexOf(symbol);
    for (const state of stateSet) {
        let i = nfa.q.indexOf(state);
        for (const transition of nfa.delta[i][j]) {
            if (transition instanceof Arrow) {
                next.add(transition.toState);
            }
        }
    }
    return next;
}


/**
 * Converts an e-NFA into an array of transitions called the 'discovery'
 * where each array entry [R, c, R'] corresponds to a transition in the
 * DFA equivalent to the input e-NFA.
 * We avoid always constructing and iterating through the entire powerset
 * of the NFA's states by traversing the NFA starting from the epsilon
 * closure of the initial state. In the worst case, the algorithm still
 * builds the entire powerset, but this is unlikely.
 * 
 * @param {FA} nfa
 * @returns the discovery array
 **/
PSConstructor.prototype.pConstruct = function (nfa) {

    let ep = nfa.sigma.indexOf('$');

    let q0closure = epsilonClosure(nfa, [nfa.q0]);

    var discovery = [];

    let exploreStack = [];
    let done = []; // Array of sets
    exploreStack.push(q0closure);

    while (exploreStack.length != 0) { // Graph traversal
        let current = exploreStack.pop();
        let originalPath = true;
        for (const set of done) {
            if (eqSet(set, current)) {
                originalPath = false;
                break;
            }
        }
        if (!originalPath) {
            continue;
        }
        for (let j = 0; j < nfa.sigma.length; j++) {
            if (j == ep) {
                continue;
            }
            let result = epsilonClosure(nfa, this.deltaGivenR(nfa, current, nfa.sigma[j]));
            discovery.push([current, j, result]);
            exploreStack.push(result);
        }
        done.push(current);
    }

    return discovery;
}

/**
 * Converts a discovery array into a graph representing a DFA
 * equivalent to the input NFA.
 * 
 * @param {FA} nfa
 * @param discovery
 * @returns {Graph} the DFA yielded from the discovery array
 **/
PSConstructor.prototype.discoveryToGraph = function (nfa, discovery) {
    var newGraph = new Graph();

    var stateSet = new Set();
    var fromStates = discovery.map(item => item[0]);
    fromStates.forEach(stateSet.add, stateSet);

    if (stateSet.size == 0) { // Handles the very special case of the "do-nothing" automaton
        stateSet.add(epsilonClosure(nfa, [nfa.q0]));
    }

    let stateArray = [...stateSet]

    // Assemble states
    for (const s of stateSet) {
        let label = [...s].reduce((a, item) => a + item.label.text + ',', '');
        label = '{' + label.slice(0, -1) + '}';
        let newState = newGraph.addState(label, 50 + Math.random() * 900, 50 + Math.random() * 400);
        let accepting = false;
        for (const x of s) {
            if (x.accepting) {
                accepting = true;
                break;
            }
        }
        if (accepting) newGraph.makeAccepting(newState);
    }

    // Assemble arrows
    for (const arrow of discovery) {
        let from = (set) => set.size === arrow[0].size && [...set].every((x) => arrow[0].has(x));
        let fromState = newGraph.states[stateArray.findIndex(from)];
        let to = (set) => set.size === arrow[2].size && [...set].every((x) => arrow[2].has(x));
        let toState = newGraph.states[stateArray.findIndex(to)];
        let symbol = nfa.sigma[arrow[1]];

        let loop = (fromState == toState);

        newGraph.addArrow(fromState, toState, symbol, loop, false);
    }

    // Set initial state
    let initial = epsilonClosure(nfa, [nfa.q0]);
    let to = (set) => set.size === initial.size && [...set].every((x) => initial.has(x));
    console.log(newGraph.states);
    let initialState = newGraph.states[stateArray.findIndex(to)];
    newGraph.addArrow(initialState, initialState, '$', false, true);

    newGraph.initialState.position(100, 288);

    return newGraph;
}

/**
 * Converts an input FA e-NFA object into a Graph object representing
 * the equivalent DFA to the input e-NFA.
 * 
 * @param {FA} nfa
 * @returns {Graph} a graph representing the equivalent DFA to the input NFA
 **/
PSConstructor.prototype.getPowersetGraph = function (nfa) {
    if (nfa.deterministic) {
        throw "Specified FA is already deterministic";
        return null;
    }
    let dfaGraph = this.discoveryToGraph(nfa, this.pConstruct(nfa));
    return dfaGraph;
}

const eqSet = (xs, ys) => xs.size === ys.size && [...xs].every((x) => ys.has(x));

// ArrowConstructor prototypes

function ArrowConstructor() {
    this.fromState = null;
    this.toState = null;
    this.initial = false;
    this.loop = false;
}

// Finite Automaton prototypes

/**
 * Create a new FA finite automaton object.
 * 
 * @param {Graph} graph
 * @returns the new FA object
 */
function FA(graph) {
    this.graph = graph;

    this.q = graph.states;

    this.sigma = [...this.getSigma(graph)];

    this.q0 = graph.initialState;
    this.f = graph.acceptingStates;

    this.q0arrow = this.graph.initialArrow;
    this.arrows = this.graph.transitions.filter(item => item != this.q0arrow);

    this.delta = null;
    this.buildTransitionFunction();

    this.currentSet = new Set();
    this.currentSet = epsilonClosure(this, [this.q0]);

    this.deterministic = this.isDeterministic();

    this.currentSet.forEach(item => item.mark());

    this.accepting = this.isAccepting();

    return this;
}

/**
 * Find the alphabet of a graph
 * 
 * @param {Graph} graph 
 * @returns the alphabet of the graph
 */
FA.prototype.getSigma = function (graph) {
    let sigma = new Set();
    for (const arrow of graph.transitions) {
        arrow.symbols.forEach(item => sigma.add(item));
    }
    return sigma;
}

FA.prototype.selfDestruct = function () {
    this.graph.selfDestruct();
}

/**
 * Converts the array of arrows in the FA's underlying graph
 * into a transition matrix of size M x N x max(M), where M is |Q|
 * and N is |Sigma|, and an element A[i][j] is an array of Arrow objects
 * corresponding to transitions from State_i for the input symbol
 * Sigma_j to successor states.
 **/
FA.prototype.buildTransitionFunction = function () {
    // Here, we build the FA's transition function as a transition matrix
    // of size MxNxM, where M is |Q| and N is |Sigma|.
    // An element A(i,j) in the matrix is an array of Arrows corresponding to
    // transitions from State_i for the input symbol Sigma_j to successor states.
    this.delta = Array(this.q.length).fill().map(
        () => Array(this.sigma.length).fill().map(
            () => []
        )
    );

    for (let m = 0; m < this.arrows.length; m++) {
        let mthArrow = this.arrows[m];
        let i = this.q.indexOf(mthArrow.fromState);

        if (mthArrow.label.text == '') {
            mthArrow.updateLabel('$');
        } // TODO: Update for multiarrow support

        for (const symbol of mthArrow.symbols) {
            let j = this.sigma.indexOf(symbol);
            this.delta[i][j].push(mthArrow);
        }
    }
}

/**
 * Resets the automaton to its initial configuration ready
 * for simulation.
 **/
FA.prototype.reset = function () {
    this.unmarkSet();
    this.currentSet.clear();
    this.currentSet = epsilonClosure(this, [this.q0]);
    this.currentSet.forEach(item => item.mark());
    this.accepting = this.isAccepting();
}

/**
 * Unmark all current states in the current state set.
 **/
FA.prototype.unmarkSet = function () {
    for (const state of this.currentSet) {
        state.unmark();
    }
}

/**
 * Returns the set of states reachable by taking all
 * transitions possible from the input state on the
 * input symbol
 * 
 * @param {State} state
 * @param {string} input
 * @returns {Set} next
 **/
FA.prototype.nextStates = function (state, input) {
    let i = this.q.indexOf(state);
    let j = this.sigma.indexOf(input);
    let next = new Set();
    for (const transition of this.delta[i][j]) {
        if (transition instanceof Arrow) {
            next.add(transition.toState);
        }
    }
    return next;
}

/**
 * Performs the path-tree blend computation method for one step
 * on the FA for the input symbol.
 * 
 * @param {string} input
 * @returns {boolean} this.isAccepting()
 **/
FA.prototype.step = function (input) {
    // Calculates the new set of current states based on the
    // epsilon closure of each state in the current states set.
    // This implements the path-thread blend motivated in section 3.1
    // of the literature review.
    if (!this.sigma.includes(input)) {
        alert("The input symbol " + input + " is not in the alphabet.");
        throw "The input symbol " + input + " is not in the alphabet.";
        return;
    }
    this.unmarkSet();
    let newCurrent = new Set();
    let nextStates = null;
    for (const state of this.currentSet) {
        nextStates = this.nextStates(state, input);
        nextStates.forEach(item => newCurrent.add(item));
    }
    this.currentSet = epsilonClosure(this, newCurrent);
    for (const state of this.currentSet) {
        state.mark();
    }
    return this.isAccepting();
}

/**
 * Returns true if the automaton accepts the current input word,
 * otherwise false, and updates the value of this.accepting.
 * 
 * @returns {boolean} this.accepting
 **/
FA.prototype.isAccepting = function () {
    this.accepting = false;
    for (const state of this.currentSet) {
        if (state.accepting) {
            this.accepting = true;
            break;
        }
    }
    return this.accepting;
}

/**
 * Returns true if the automaton is a DFA, otherwise false.
 * 
 * @returns {boolean} deterministic
 **/
FA.prototype.isDeterministic = function () {
    // For a finite automaton to be deterministic, every state must
    // have exactly one transition for every symbol in its alphabet.
    // Here, transitions are Arrows and symbols are the associated
    // Arrow.symbols. This is done by iterating over the adjacency
    // matrix.

    let deterministic = true;

    if (this.sigma.includes("$")) {
        deterministic = false;
        return deterministic;
    }

    for (let i = 0; i < this.q.length; i++) {
        for (let j = 0; j < this.sigma.length; j++) {
            let len = this.delta[i][j].filter(item => item).length;
            if (len != 1) deterministic = false;
        }
    }

    return deterministic;
}

// Graph prototypes

function Graph() {
    this.states = [];
    this.transitions = [];
    this.initialState = null;
    this.initialArrow = null;
    this.acceptingStates = [];
}

/**
 * Remove all states in the current Graph ready for
 * full deletion.
 **/
Graph.prototype.selfDestruct = function () {
    this.states.forEach(item => this.removeState(item));
}

/**
 * Set a state in the Graph to be accepting, adding it
 * to this.acceptingStates
 * 
 * @param {State} state
 **/
Graph.prototype.makeAccepting = function (state) {
    if (this.states.includes(state)) {
        if (this.acceptingStates.includes(state)) {
            throw "State is already accepting";
        } else {
            this.acceptingStates.push(state);
            state.makeAccepting();
        }
    } else {
        throw "State not in graph";
    }
}

/**
 * Set an accepting state as normal again, removing it
 * from this.acceptingStates
 * 
 * @param {State} state
 **/
Graph.prototype.removeAcception = function (state) {
    if (this.acceptingStates.includes(state)) {
        this.acceptingStates = this.acceptingStates.filter(item => item !== state);
        state.makeNormal();
    } else {
        throw "State is already normal or not in graph";
    }
}

/**
 * Create and add a state to the Graph.
 * 
 * @param {string} text
 * @param x
 * @param y
 **/
Graph.prototype.addState = function (text, x, y) {
    let newState = new State(text, x, y);
    this.states.push(newState);
    return newState;
}

/**
 * Remove a state from the graph and delete it.
 * 
 * @param {State} state
 **/
Graph.prototype.removeState = function (state) {
    this.states = this.states.filter(item => item !== state);
    this.acceptingStates = this.acceptingStates.filter(item => item !== state);

    let arrowsToRemove = this.getConnectedArrows(state);

    for (let i = 0; i < arrowsToRemove.length; i++) {
        this.removeArrow(arrowsToRemove[i]);
    }
    if (this.initialState == state) this.removeArrow(this.initialArrow);

    state.graphics.destroy(true);
    delete state;
}

/**
 * Find and return all Arrows connected to a State, including
 * inward, outward, looping, and the initial arrow.
 * 
 * @param {State} state
 * @returns {Array} connectedArrows
 **/
Graph.prototype.getConnectedArrows = function (state) {
    let connectedArrows = [];
    for (let i = 0; i < this.transitions.length; i++) {
        if ((this.transitions[i].fromState == state) || (this.transitions[i].toState == state)) {
            connectedArrows.push(this.transitions[i]);
        }
    }
    return connectedArrows;
}

/**
 * Create and add an arrow between two states to the graph.
 * 
 * @param {State} fromState
 * @param {State} toState
 * @param {string} text
 * @param {boolean} loop
 * @param {boolean} initial
 * @returns {Arrow} the new arrow object
 **/
Graph.prototype.addArrow = function (fromState, toState, text, loop, initial) {
    for (const arrow of this.transitions) {
        if (fromState == arrow.fromState && toState == arrow.toState && loop == arrow.loop && initial == arrow.initial) {
            arrow.updateLabel(arrow.label.text + ',' + text);
            return arrow;
        }
    }
    let newArrow = new Arrow(fromState, toState, text, loop, initial);

    if (initial) {
        if (this.initialArrow) this.removeArrow(this.initialArrow);
        this.initialState = fromState;
        this.initialArrow = newArrow;
    } else this.transitions.push(newArrow);
    return newArrow;
}

/**
 * Remove an arrow from the graph and delete it.
 * 
 * @param {Arrow} arrow
 **/
Graph.prototype.removeArrow = function (arrow) {
    if (arrow == this.initialArrow) {
        this.initialArrow = null;
        this.initialState = null;
    }
    this.transitions = this.transitions.filter(item => item !== arrow);
    arrow.label.destroy();
    arrow.graphics.destroy(true);
    delete arrow;
}

// State prototypes

/**
 * Create a new State object
 * 
 * @param {string} text - Initial label
 * @param {int} x  - Initial x position
 * @param {int} y - Initial y position
 * @returns the new State object
 */
function State(text, x, y) {
    this.graphics = new PIXI.Graphics();
    this.name = text;
    this.label = new PIXI.Text(text, cmodern);
    this.updateLabel(text);

    this.initGraphics(x, y);

    this.accepting = false;

    this.marked = false;

    this.focused = false;

    return this;
}

/**
 * Initialise graphics for state on the main PIXI canvas.
 * Note: Will only update correctly if the state is in workingGraph.
 * 
 * @param {int} x - Initial x coordinate
 * @param {int} y - Initial y coordinate
 **/
State.prototype.initGraphics = function (x, y) {
    this.graphics.lineStyle(2, 0x000000);
    this.graphics.beginFill(0xffffff);
    this.graphics.drawCircle(STATE_RADIUS, STATE_RADIUS, STATE_RADIUS);
    this.graphics.endFill();

    this.graphics.x = x;
    this.graphics.y = y;

    this.graphics.pivot.x = this.graphics.width / 2;
    this.graphics.pivot.y = this.graphics.height / 2;

    this.label.x = this.graphics.width / 2;
    this.label.y = this.graphics.height / 2;
    this.label.anchor.set(0.5);
    this.graphics.addChild(this.label);

    this.initInteraction();
    app.stage.addChild(this.graphics);
}

/**
 * Initialise PIXI-controlled interaction for the state.
 **/
State.prototype.initInteraction = function () {
    this.graphics.interactive = true;
    this.graphics.cursor = 'pointer';
    this.graphics.on('pointerdown', onDragStart, this.graphics);
    this.graphics.on('pointerdown', onButtonDown, this);
}

/**
 * Indicate a state is accepting graphically.
 **/
State.prototype.makeAccepting = function () {
    this.accepting = true;
    this.graphics.lineStyle(2, 0x000000);
    this.graphics.drawCircle(STATE_RADIUS, STATE_RADIUS, STATE_RADIUS - 3);
}

/**
 * Indicate a state is normal graphically.
 **/
State.prototype.makeNormal = function () {
    this.accepting = false;
    this.graphics.clear();
    this.graphics.lineStyle(2, 0x000000);
    this.graphics.beginFill(0xffffff);
    this.graphics.drawCircle(STATE_RADIUS, STATE_RADIUS, STATE_RADIUS);
    this.graphics.endFill();
}

/**
 * Redraw the state according to its current properties.
 **/
State.prototype.redraw = function () {
    this.graphics.clear();
    this.graphics.lineStyle(2, 0x000000);
    this.graphics.beginFill(0xffffff);
    this.graphics.drawCircle(STATE_RADIUS, STATE_RADIUS, STATE_RADIUS);
    this.graphics.endFill();
    if (this.accepting) {
        this.graphics.lineStyle(2, 0x000000);
        this.graphics.drawCircle(STATE_RADIUS, STATE_RADIUS, STATE_RADIUS - 3);
    }
    if (this.marked) {
        this.mark();
    }
    if (this.focused) {
        this.focus();
    }
}

/**
 * Focus the state on the canvas.
 **/
State.prototype.focus = function () {
    this.focused = true;
    this.graphics.lineStyle(2, FOCUS_COLOR);
    this.graphics.drawCircle(STATE_RADIUS, STATE_RADIUS, STATE_RADIUS + 2);
}

/**
 * Unfocus the state on the canvas.
 **/
State.prototype.unfocus = function () {
    this.focused = false;
    this.redraw();
}

/**
 * Indicate the state is a current state during simulation.
 **/
State.prototype.mark = function () {
    this.marked = true;
    if (this.accepting) {
        this.green();
    } else {
        this.red();
    }
}

/**
 * Unmark the state on the canvas.
 **/
State.prototype.unmark = function () {
    this.marked = false;
    this.redraw();
}

/**
 * Colour a state red, indicating it is current but not accepting.
 **/
State.prototype.red = function () {
    this.graphics.beginFill(0xdd0000, 0.2);
    this.graphics.drawCircle(STATE_RADIUS, STATE_RADIUS, STATE_RADIUS);
    this.graphics.endFill();
}

/**
 * Colour a state green, indicating it is current and accepting.
 **/
State.prototype.green = function () {
    this.graphics.beginFill(0x00dd00, 0.2);
    this.graphics.drawCircle(STATE_RADIUS, STATE_RADIUS, STATE_RADIUS);
    this.graphics.endFill();
}

/**
 * Change the name of the state.
 * 
 * @param {string} text
 **/
State.prototype.updateLabel = function (text) {
    this.name = text;
    this.label.text = text;
    this.label.scale.x = 1;
    this.label.scale.y = 1;
    if (this.label.width > 2 * STATE_RADIUS - 10) {
        this.label.scale.x = (2 * STATE_RADIUS - 10) / this.label.width;
        this.label.scale.y = (2 * STATE_RADIUS - 10) / this.label.width;
    }
}

/**
 * Move the state to the PIXI canvas position (x,y).
 * 
 * @param x
 * @param y
 **/
State.prototype.position = function (x, y) {
    this.graphics.x = x;
    this.graphics.y = y;
}

// Arrow prototypes

function Arrow(fromState, toState, text, loop, initial) {
    this.loop = loop;
    this.initial = initial;

    this.fromState = fromState;
    this.toState = toState;

    this.graphics = new PIXI.Graphics();
    this.label = new PIXI.Text(text, cmodern);

    this.symbols = new Set();
    this.updateLabel(text);

    if (initial) {
        this.label.visible = false;
    }

    this.focused = false;

    this.graphics.curve = 0;

    this.initGraphics();

    return this;
}

/**
 * Initialise PIXI graphics for arrow on canvas.
 **/
Arrow.prototype.initGraphics = function () {
    this.initInteraction();

    app.stage.addChild(this.graphics);
    if (!this.loop && !this.initial) {
        app.stage.addChild(this.label);
    } else {
        this.label.anchor.set(0.5, 0.5);
        this.graphics.addChild(this.label);
    }
}

/**
 * Initialise PIXI-controlled interaction for arrow.
 **/
Arrow.prototype.initInteraction = function () {
    this.graphics.interactive = true;
    this.graphics.cursor = 'pointer';
    this.graphics.on('pointerdown', onButtonDown, this);

    this.label.interactive = true;
    this.label.cursor = 'pointer';
    this.label.on('pointerdown', onButtonDown, this);

    if (this.initial) {
        this.graphics.toState = this.toState;
        this.graphics.on('pointerdown', onInitialArrowDragStart, this.graphics);
    } else if (this.loop) {
        this.graphics.fromState = this.fromState;
        this.graphics.label = this.label;
        this.graphics.on('pointerdown', onLoopArrowDragStart, this.graphics);
    } else {
        this.graphics.on('pointerdown', onArrowDragStart, this);
        this.label.on('pointerdown', onArrowDragStart, this);
    }
}

/**
 * Redraw the arrow on the PIXI canvas.
 **/
Arrow.prototype.update = function () {
    if (this.initial) {
        this.updateInitial();
        return;
    } else if (this.loop) {
        this.updateLoop();
        return;
    }

    this.graphics.clear();

    if (this.focused) {
        this.graphics.lineStyle(2, FOCUS_COLOR, 1);
    } else {
        this.graphics.lineStyle(2, 0x000000, 1);
    }

    let state1 = this.fromState.graphics;
    let state2 = this.toState.graphics;

    let curve = this.graphics.curve;

    let dx = state1.x - state2.x;
    let dy = state1.y - state2.y;

    if (curve <= 5 && curve >= -5) {
        this.drawStraightArrow(state1, state2, dx, dy);
        return;
    }

    let distance = Math.sqrt(dx * dx + dy * dy);

    let anchorX = state2.x + dx * 0.5 - (dy * curve / distance);
    let anchorY = state2.y + dy * 0.5 + (dx * curve / distance);

    let c = circleFromABC(state2.x, state2.y, state1.x, state1.y, anchorX, anchorY);

    let startAngle, endAngle, midAngle = 0;

    if (curve > 5) {
        startAngle = Math.atan2(c.y - state1.y, c.x - state1.x) + STATE_RADIUS / c.r;
        endAngle = Math.atan2(c.y - state2.y, c.x - state2.x) - STATE_RADIUS / c.r;
        this.graphics.arc(
            c.x,
            c.y,
            c.r,
            Math.PI + startAngle,
            Math.PI + endAngle
        );

        midAngle = ((endAngle < startAngle ? endAngle + 2 * Math.PI : endAngle) + startAngle) / 2;

    } else {
        startAngle = Math.atan2(c.y - state1.y, c.x - state1.x) - STATE_RADIUS / c.r;
        endAngle = Math.atan2(c.y - state2.y, c.x - state2.x) + STATE_RADIUS / c.r;
        this.graphics.arc(
            c.x,
            c.y,
            c.r,
            Math.PI + endAngle,
            Math.PI + startAngle
        );

        midAngle = ((endAngle > startAngle ? endAngle + 2 * Math.PI : endAngle) + startAngle) / 2;
    }

    this.label.anchor.set(0.5, 0.5);
    this.label.x = c.x + (c.r + this.label.width / 2 + 15) * Math.cos(Math.PI + midAngle);
    this.label.y = c.y + (c.r + 15) * Math.sin(Math.PI + midAngle);

    ax = c.x + c.r * Math.cos(Math.PI + endAngle);
    ay = c.y + c.r * Math.sin(Math.PI + endAngle);

    drawArrowhead(this.graphics, ax, ay, -endAngle);

}

Arrow.prototype.drawStraightArrow = function (state1, state2, dx, dy) {
    let point1 = closestPointOnCircle(state2.x, state2.y, state1.x, state1.y, STATE_RADIUS);
        this.graphics.moveTo(point1.x, point1.y);
        let point2 = closestPointOnCircle(state1.x, state1.y, state2.x, state2.y, STATE_RADIUS);
        this.graphics.lineTo(point2.x, point2.y);

        let textAngle = Math.atan2(state2.x - state1.x, state1.y - state2.y);
        let sin = Math.sin(textAngle + Math.PI);
        let cos = Math.cos(textAngle + Math.PI);
        this.label.anchor.set((cos > 0 ? 0 : 1), (sin > 0 ? 0 : 1));
        this.label.x = (state2.x + dx * 0.5) + cos * 5
        this.label.y = (state2.y + dy * 0.5) + sin * 5

        drawArrowhead(this.graphics, point2.x, point2.y, point2.angle);
}

/**
 * Redraw an initial arrow on the PIXI canvas
 **/
Arrow.prototype.updateInitial = function () {
    this.graphics.x = this.toState.graphics.x;
    this.graphics.y = this.toState.graphics.y;

    this.graphics.clear();
    this.graphics.moveTo(-STATE_RADIUS - 25, 0);
    if (this.focused) {
        this.graphics.lineStyle(2, FOCUS_COLOR, 1);
    } else {
        this.graphics.lineStyle(2, 0x000000, 1);
    }
    this.graphics.lineTo(-STATE_RADIUS, 0);

    drawArrowhead(this.graphics, -STATE_RADIUS, 0, 2 * Math.PI - Math.PI / 2);

}

/**
 * Redraw a loop arrow on the PIXI canvas
 **/
Arrow.prototype.updateLoop = function () {
    // Control points for bezier curve with respect to state
    let p1x = -20;
    let p1y = -50 - STATE_RADIUS;

    let p2x = +20;
    let p2y = -50 - STATE_RADIUS;

    let start = closestPointOnCircle(p1x, p1y, 0, 0, STATE_RADIUS);
    let end = closestPointOnCircle(p2x, p2y, 0, 0, STATE_RADIUS);

    this.graphics.clear();

    this.graphics.x = this.fromState.graphics.x;
    this.graphics.y = this.fromState.graphics.y;
    this.graphics.moveTo(start.x, start.y);
    if (this.focused) {
        this.graphics.lineStyle(2, FOCUS_COLOR, 1);
    } else {
        this.graphics.lineStyle(2, 0x000000, 1);
    }
    this.graphics.bezierCurveTo(
        p1x, p1y,
        p2x, p2y,
        end.x, end.y
    );

    this.label.x = 0;
    this.label.y = p2y - 5 * Math.abs(Math.cos(this.graphics.rotation));
    this.label.anchor.set(0.5 - 0.5 * Math.sin(this.graphics.rotation), 0.5);

    drawArrowhead(this.graphics, end.x, end.y, end.angle);

}

/**
 * Focus the arrow on the canvas
 **/
Arrow.prototype.focus = function () {
    this.focused = true;
}

/**
 * Unfocus the arrow on the canvas
 **/
Arrow.prototype.unfocus = function () {
    this.focused = false;
}

/**
 * Update the arrow's symbol set and label according to
 * the input text.
 * 
 * @param {string} text
 **/
Arrow.prototype.updateLabel = function (text) {
    if (text == '') {
        text = "$";
    }
    this.label.text = text;
    this.symbols.clear();
    text.split(',').forEach(item => this.symbols.add(item));
    this.symbols.delete('');
}

/**
 * Render and redraw all arrows in the current working graph.
 **/
function updateAll() {
    for (let i = 0; i < workingGraph.transitions.length; i++) {
        workingGraph.transitions[i].update();
    }
    if (workingGraph.initialArrow) workingGraph.initialArrow.update();
}

// Helper functions

/**
 * Draw an arrowhead at a point given an angle.
 * 
 * @param {PIXI.Graphics} arrow
 * @param x
 * @param y
 * @param angle
 */
function drawArrowhead(arrow, x, y, angle) {
    arrow.moveTo(x, y);
    arrow.beginFill(0x000000);
    if (arrow.curve < -5) {
        arrow.lineTo(x - 10 * Math.sin(Math.PI / 6 + angle), y - 10 * Math.cos(Math.PI / 6 + angle));
        arrow.lineTo(x - 10 * Math.sin(angle - Math.PI / 6), y - 10 * Math.cos(angle - Math.PI / 6));
    } else {
        arrow.lineTo(x + 10 * Math.sin(Math.PI / 6 + angle), y + 10 * Math.cos(Math.PI / 6 + angle));
        arrow.lineTo(x + 10 * Math.sin(angle - Math.PI / 6), y + 10 * Math.cos(angle - Math.PI / 6));
    }
    arrow.lineTo(x, y);
    arrow.endFill();
}

/**
 * Calculate the closest point from (x1,y1) on a circle with centre (x2,y2) and radius r
 * 
 * @param x1 - x coordinate of point
 * @param y1 - y coordinate of point
 * @param x2 - x coordinate of circle centre
 * @param y2 - y coordinate of circle centre
 * @param r - radius of circle
 * 
 * @returns {Object}
 */
function closestPointOnCircle(x1, y1, x2, y2, r) {
    let angle = Math.atan2(x1 - x2, y1 - y2);
    return {
        'x': x2 + r * Math.sin(angle),
        'y': y2 + r * Math.cos(angle),
        'angle': angle
    }
}

//-----Main-----//

// Canvas initialisation

app.stage.interactive = true;
app.stage.hitArea = app.screen;
app.stage.on('pointerup', onDragEnd);
app.stage.on('pointerupoutside', onDragEnd);

// Interaction initialisation

document.getElementById('accept').disabled = true;

var dragTarget = null;
var focusTarget = null;
var lastFocused = null;
var mousePos = { x: 0, y: 0 };
var creatingArrow = null;
var addingState = false;

let bg = new PIXI.Sprite(); // Invisible sprite for deselecting
bg.width = app.screen.width;
bg.height = app.screen.height;

bg.interactive = true;
bg.on('pointerdown', onButtonDown, bg);
app.stage.addChild(bg);

let stateGhost = new PIXI.Graphics(); // Normally invisible stage 'ghost', visible on state creation
stateGhost.lineStyle({ width: 2, color: 0x000000 });
stateGhost.beginFill(0xffffff);
stateGhost.drawCircle(STATE_RADIUS, STATE_RADIUS, STATE_RADIUS);
stateGhost.endFill();
stateGhost.alpha = 0.5;

stateGhost.pivot.x = stateGhost.width / 2;
stateGhost.pivot.y = stateGhost.height / 2;

app.stage.addEventListener('pointermove', (e) => {
    stateGhost.position.copyFrom(e.global);
});
stateGhost.interactive = true;
stateGhost.on('pointerdown', onButtonDown, stateGhost);

app.stage.addChild(stateGhost);
stateGhost.visible = false;

let arrowGhost = new PIXI.Text("Click on starting state, or canvas if initial.", cmodern);
arrowGhost.x = 15;
arrowGhost.y = 15;

arrowGhost.visible = false;
app.stage.addChild(arrowGhost);

let logo = new PIXI.Text("Create", logoFont);
logo.x = 880;
logo.y = 10;
logo.alpha = 0.5;
app.stage.addChild(logo);

let wordTracker = new PIXI.Text('Word: ', cmodern);
wordTracker.x = 10;
wordTracker.y = 540;

app.stage.addChild(wordTracker);
wordTracker.visible = false;

let acceptTracker = new PIXI.Text('String Accepted', acceptFont);
acceptTracker.x = 850;
acceptTracker.y = 520;
acceptTracker.fill = 0x00bb00;

app.stage.addChild(acceptTracker);
acceptTracker.visible = false;

function initControls() {

    let inputbox = document.getElementById('inputbox');
    let wordbox = document.getElementById('wordbox');

    let delstate = document.getElementById('delstate');
    let addstate = document.getElementById('addstate');

    let addarrow = document.getElementById('addarrow');

    let acceptingButton = document.getElementById('accept');

    inputbox.value = null;
    inputbox.disabled = true;
    delstate.disabled = true;
    wordbox.value = null;

    // Create mode UI elements

    addstate.onclick = function () {
        addingState = true;
        stateGhost.visible = true;
    }

    delstate.onclick = function () {
        if (focusTarget instanceof State) {
            workingGraph.removeState(focusTarget);
        } else if (focusTarget instanceof Arrow) {
            workingGraph.removeArrow(focusTarget);
        }
        focusTarget = null;
        lastFocused = null;
        inputbox.value = null;
        inputbox.placeholder = "Nothing selected";
        inputbox.disabled = true;
        delstate.disabled = true;
        acceptingButton.disabled = true;
    }

    inputbox.oninput = function () {
        if ((focusTarget instanceof State) || (focusTarget instanceof Arrow)) {
            focusTarget.updateLabel(inputbox.value);
            if (inputbox.value == '') {
                inputbox.placeholder = "Empty string";
            }
        }
    }

    addarrow.onclick = function () {
        if (workingGraph.states[0] && creatingArrow === null) {
            creatingArrow = new ArrowConstructor();
            arrowGhost.visible = true;
        }
    }

    acceptingButton.onclick = function () {
        if (focusTarget instanceof State) {
            if (focusTarget.accepting) {
                workingGraph.removeAcception(focusTarget);
                acceptingButton.value = "Normal";
            } else {
                workingGraph.makeAccepting(focusTarget);
                acceptingButton.value = "Accepted";
            }
        }
    }

    // Mode switching

    function cancelAdditions() {
        addingState = false;
        stateGhost.visible = false;
        arrowGhost.visible = false;
        arrowGhost.text = "Click on starting state, or canvas if initial.";
        delete creatingArrow;
        creatingArrow = null;
    }

    document.getElementById('simulate').onclick = function () {
        cancelAdditions();
        if (workingGraph.initialState) {
            document.getElementById('inputs').style.display = "none";
            document.getElementById('simulates').style.display = "inline-block";
            wordTracker.visible = true;
            logo.text = "Simulate";
            workingAutomaton = new FA(workingGraph);
            document.getElementById('stepOne').disabled = true;
            if (workingAutomaton.deterministic) {
                document.getElementById('convert').disabled = true;
            } else {
                document.getElementById('convert').disabled = false;
            }
            if (workingAutomaton.accepting) {
                acceptTracker.visible = true;
            } else {
                acceptTracker.visible = false;
            }
            if (wordbox.value != '') document.getElementById('stepOne').disabled = false;
        } else {
            alert("Automaton needs an initial state.");
        }
    }

    document.getElementById('create').onclick = function () {
        document.getElementById('inputs').style.display = "inline-block";
        document.getElementById('simulates').style.display = "none";
        document.getElementById('regexes').style.display = "none";
        logo.text = "Create";
        if (workingAutomaton) {
            for (let i = 0; i < workingAutomaton.q.length; i++) {
                workingAutomaton.q[i].unmark();
            }
        }
        workingAutomaton = null;
        wordTracker.text = "Word: "
        wordTracker.visible = false;
        acceptTracker.visible = false;
    }

    document.getElementById('create2').onclick = function () {
        document.getElementById('inputs').style.display = "inline-block";
        document.getElementById('simulates').style.display = "none";
        document.getElementById('regexes').style.display = "none";
        logo.text = "Create";
    }

    document.getElementById('regex').onclick = function () {
        cancelAdditions();
        document.getElementById('inputs').style.display = "none";
        document.getElementById('simulates').style.display = "none";
        document.getElementById('regexes').style.display = "inline-block";
        logo.text = "Regex";
    }

    // Regex mode UI elements

    document.getElementById('regToNFA').onclick = function () {
        let input = document.getElementById('regexbox').value;
        let regGraph = regexParser.thompson(input);
        if (regGraph === null) return;
        workingGraph.selfDestruct();
        workingGraph = regGraph;
        focusTarget = null;
        lastFocused = null;
        onButtonDown(null);
    }
    document.getElementById('NFAToReg').onclick = function () {
        let copyNFA = copyGraph(workingGraph);
        let regexOut = nfaToRegex(copyNFA);
        copyNFA.selfDestruct();
        copyNFA = null;
        delete copyNFA;
        document.getElementById('regexbox').value = regexOut;
    }

    // Simulate mode UI elements

    wordbox.oninput = function () {
        if (wordbox.value == '') {
            document.getElementById('stepOne').disabled = true;
        } else {
            document.getElementById('stepOne').disabled = false;
        }
    }

    function assembleSymbol(wordboxValue) {
        let inputSymbol = ""
        for (let i = 0; i < wordboxValue.length; i++) {
            inputSymbol += wordboxValue.charAt(i);
            if (wordboxValue.charAt(i) == '>') {
                return inputSymbol;
            }
        }
        alert("Warning - missing closing angle brackets.");
        return null;
    }

    document.getElementById('stepOne').onclick = function () {
        if (wordbox.value != '') {
            let multisymbol = false;
            let inputSymbol = wordbox.value[0];
            if (inputSymbol == '<') {
                multisymbol = true;
                inputSymbol = assembleSymbol(wordbox.value);
            }
            if (!inputSymbol) {
                return;
            }
            if (multisymbol) {
                console.log(inputSymbol.substring(1, inputSymbol.length - 1));
                workingAutomaton.step(inputSymbol.substring(1, inputSymbol.length - 1));
            } else {
                workingAutomaton.step(inputSymbol);
            }
            if (workingAutomaton.accepting) {
                acceptTracker.visible = true;
            } else {
                acceptTracker.visible = false;
            }
            wordbox.value = wordbox.value.substring(inputSymbol.length);
            wordTracker.text = wordTracker.text += inputSymbol;
        }
        if (wordbox.value.length == 0) {
            document.getElementById('stepOne').disabled = true;
        }
    }

    document.getElementById('resetAuto').onclick = function () {
        wordbox.value = '';
        document.getElementById('stepOne').disabled = true;
        workingAutomaton.reset();
        wordTracker.text = "Word: "
        if (workingAutomaton.accepting) {
            acceptTracker.visible = true;
        } else {
            acceptTracker.visible = false;
        }
    }

    document.getElementById('convert').onclick = function () {
        let dfaGraph = psConstructor.getPowersetGraph(workingAutomaton);
        if (dfaGraph.states.length > 0) {
            workingAutomaton.selfDestruct();
            workingGraph = dfaGraph;
            workingAutomaton = new FA(workingGraph);
            workingAutomaton.reset();
            wordTracker.text = "Word: ";
            if (workingAutomaton.accepting) {
                acceptTracker.visible = true;
            } else {
                acceptTracker.visible = false;
            }
            document.getElementById('convert').disabled = true;
        } else {
            //acceptTracker.visible = false;
            //workingAutomaton.selfDestruct();
            //workingAutomaton = null;
        }
        focusTarget = null;
        lastFocused = null;
        onButtonDown(null);
    }
}

initControls();

// Demo configuration

var graph = new Graph();
workingGraph = graph;

var q1 = graph.addState("1", 400, 300);
var q2 = graph.addState("2", 600, 200);
var q3 = graph.addState("3", 600, 400);

graph.addArrow(q1, q2, '$', false, false);
graph.addArrow(q1, q3, 'a', false, false);
graph.addArrow(q2, q2, 'b', true, false);
graph.addArrow(q3, q3, 'a,b', true, false);
graph.addArrow(q1, q1, '$', false, true);

graph.makeAccepting(q2);
graph.makeAccepting(q3);

// Event handling functions

/**
 * Handles the focusing and adding of states and arrows.
 * 
 * @param {*} event 
 * @returns 
 */
function onButtonDown(event) {
    focusTarget = this;

    if (addingState) { // Handle state creation
        focusTarget = workingGraph.addState(workingGraph.states.length + 1, event.global.x, event.global.y);
        addingState = false;
        stateGhost.visible = false;
    }

    if (creatingArrow instanceof ArrowConstructor) { // Handle arrow creation
        if ((creatingArrow.fromState || creatingArrow.initial) && focusTarget instanceof State) { // Stage 2
            creatingArrow.toState = focusTarget;
            if (creatingArrow.initial) {
                creatingArrow.fromState = focusTarget;
                if (workingGraph.initialArrow) workingGraph.removeArrow(workingGraph.initialArrow);
                workingGraph.initialState = focusTarget;
            }
            focusTarget = workingGraph.addArrow(
                creatingArrow.fromState,
                creatingArrow.toState,
                "$",
                (creatingArrow.fromState == creatingArrow.toState),
                creatingArrow.initial
            );
            if (creatingArrow.initial) {
                workingGraph.initialArrow = focusTarget;
            }
            delete creatingArrow;
            creatingArrow = null;
            arrowGhost.visible = false;
            arrowGhost.text = "Click on starting state, or canvas if initial.";
        } else if (focusTarget instanceof State) { // Stage 1 for state->state arrow
            creatingArrow.fromState = focusTarget;
            arrowGhost.text = "Click on finishing state.";
            return;
        } else if ((focusTarget == bg) && !creatingArrow.initial && !creatingArrow.fromState) { // Stage 1 for initial arrow
            creatingArrow.initial = true;
            arrowGhost.text = "Click on initial state.";
            return;
        } else { // Terminate creation
            arrowGhost.visible = false;
            arrowGhost.text = "Click on starting state, or canvas if initial.";
            delete creatingArrow;
            creatingArrow = null;
            return;
        }
    }

    if (focusTarget instanceof State) { // Handle accepting/normal button
        document.getElementById('accept').disabled = false;
        if (focusTarget.accepting) {
            document.getElementById('accept').value = "Accepting";
        } else {
            document.getElementById('accept').value = "Normal";
        }
    } else {
        document.getElementById('accept').disabled = true;
    }

    if ((focusTarget instanceof State) || (focusTarget instanceof Arrow)) { // Handle transition input box
        if (lastFocused) lastFocused.unfocus();
        focusTarget.focus();
        lastFocused = focusTarget;
        document.getElementById('inputbox').disabled = false;
        document.getElementById('delstate').disabled = false;
        document.getElementById('inputbox').value = focusTarget.label.text;
        if (focusTarget.label.text == '') {
            document.getElementById('inputbox').placeholder = 'Empty string';
        }
        if (focusTarget.initial) {
            document.getElementById('inputbox').disabled = true;
        }
    } else {
        if (lastFocused) lastFocused.unfocus();
        lastFocused = null;
        document.getElementById('inputbox').value = '';
        document.getElementById('inputbox').placeholder = 'Nothing selected';
        document.getElementById('inputbox').disabled = true;
        document.getElementById('delstate').disabled = true;
    }
}

function onDragMove(event) {
    if (dragTarget) {
        dragTarget.parent.toLocal(event.global, null, dragTarget.position);
    }
}

function onArrowDragMove(event) {
    let dy = mousePos.y - event.global.y;
    if (dragTarget) {
        if (dragTarget.toState.graphics.x < dragTarget.fromState.graphics.x) {
            dragTarget.graphics.curve -= Math.round(dy);
        } else {
            dragTarget.graphics.curve += Math.round(dy);
        }
        mousePos.y = event.global.y;
    }
}

function onLoopArrowDragMove(event) {
    if (dragTarget) {
        let dx = event.global.x - dragTarget.fromState.graphics.x;
        let dy = event.global.y - dragTarget.fromState.graphics.y;
        let angle = Math.atan2(dy, dx);

        // Loop arrow is by default at PI/2, therefore we add PI/2 as an offset
        dragTarget.rotation = angle + Math.PI / 2;
        // Label is rotated by negative of the loop to maintain visible orientation
        dragTarget.label.rotation = -(angle + Math.PI / 2);

        let snap = Math.round(dragTarget.angle / (90)) * (90);
        if (Math.abs(dragTarget.angle - snap) < 5) {
            dragTarget.angle = snap;
            dragTarget.label.angle = -snap;
        }
    }
}

function onLoopArrowDragStart(event) {
    dragTarget = this;
    app.stage.on('pointermove', onLoopArrowDragMove);
    mousePos.x = event.global.x;
    mousePos.y = event.global.y;
}

function onInitialArrowDragMove(event) {
    let dx = mousePos.x - event.global.x;
    if (dragTarget) {
        let dx = event.global.x - dragTarget.toState.graphics.x;
        let dy = event.global.y - dragTarget.toState.graphics.y;
        let angle = Math.atan2(dy, dx);

        // Initial arrow is by default at PI, therefore we add PI as an offset
        dragTarget.rotation = angle + Math.PI;

        let snap = Math.round(dragTarget.angle / (90)) * (90);
        if (Math.abs(dragTarget.angle - snap) < 5) {
            dragTarget.angle = snap;
        }
    }
}

function onInitialArrowDragStart(event) {
    dragTarget = this;
    app.stage.on('pointermove', onInitialArrowDragMove);
    mousePos.x = event.global.x;
    mousePos.y = event.global.y;
}

function onArrowDragStart(event) {
    dragTarget = this;
    app.stage.on('pointermove', onArrowDragMove);
    mousePos.x = event.global.x;
    mousePos.y = event.global.y;
}

function onDragStart() {
    dragTarget = this;
    app.stage.on('pointermove', onDragMove);
}

function onDragEnd() {
    if (dragTarget) {
        app.stage.off('pointermove', onDragMove);
        app.stage.off('pointermove', onArrowDragMove);
        app.stage.off('pointermove', onLoopArrowDragMove);
        app.stage.off('pointermove', onInitialArrowDragMove);
        dragTarget = null;
    }
}


// Render loop

let elapsed = 0.0;
app.ticker.add((delta) => {
    //elapsed += delta;
    if (!document.hidden) { // Optimisation - do not update if tab is not active
        updateAll();
    }
});
app.ticker.maxFPS = 60;