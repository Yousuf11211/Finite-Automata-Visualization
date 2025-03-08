
function det2x2(a, b, c, d) {
    return a * d - b * c;
}

function det3x3(a, b, c, d, e, f, g, h, i) {
    return a * det2x2(e, f, h, i) - b * det2x2(d, f, g, i) + c * det2x2(d, e, g, h);
}

function circleFromABC(x1, y1, x2, y2, x3, y3) {
    var m11 = det3x3(
        x1, y1, 1,
        x2, y2, 1,
        x3, y3, 1
    );
    var m12 = det3x3(
        x1 * x1 + y1 * y1, y1, 1,
        x2 * x2 + y2 * y2, y2, 1,
        x3 * x3 + y3 * y3, y3, 1
    );
    var m13 = det3x3(
        x1 * x1 + y1 * y1, x1, 1,
        x2 * x2 + y2 * y2, x2, 1,
        x3 * x3 + y3 * y3, x3, 1
    );
    var m14 = det3x3(
        x1 * x1 + y1 * y1, x1, y1,
        x2 * x2 + y2 * y2, x2, y2,
        x3 * x3 + y3 * y3, x3, y3
    );

    x0 = 0.5 * m12 / m11;
    y0 = 0.5 * m13 / m11;
    r = Math.sqrt(x0 * x0 + y0 * y0 + m14 / m11);
    return {
        'x': x0,
        'y': -y0,
        'r': r
    };
}