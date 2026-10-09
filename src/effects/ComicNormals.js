import * as THREE from 'three';

// 0x41baa0 / 0x41bd10: the original reciprocal-square-root table and its
// integer interpolation. Keeping its quantization also preserves packed light.
const inverseRoots = new Int32Array(257);
for (let i = 1; i <= 256; i++) {
	inverseRoots[i] = Math.trunc(4294967296 / Math.floor(Math.sqrt(i * 67108864))) - 1;
}
const multiply = (a, b) => Math.floor(a * b / 65536) | 0;

export function normalizeFixed(x, y, z, target = [], offset = 0, divisor = 1) {
	let lengthSquared = Math.floor((x * x + y * y + z * z) / 65536);
	if (lengthSquared < 4) {
		target[offset] = 65536 / divisor; target[offset + 1] = target[offset + 2] = 0;
		return target;
	}
	let shift = 0;
	if (lengthSquared < 49152) {
		while (lengthSquared < 49152) { lengthSquared *= 4; shift--; }
	} else {
		if (lengthSquared >= 4294967296) { lengthSquared = Math.floor(lengthSquared / 65536); shift = 8; }
		if (lengthSquared >= 16777216) { lengthSquared = Math.floor(lengthSquared / 256); shift += 4; }
		if (lengthSquared >= 1048576) { lengthSquared = Math.floor(lengthSquared / 16); shift += 2; }
		if (lengthSquared >= 262144) { lengthSquared = Math.floor(lengthSquared / 4); shift++; }
	}
	const i = Math.floor(lengthSquared / 1024), fraction = lengthSquared % 1024;
	const reciprocal = inverseRoots[i] + Math.trunc(fraction * (inverseRoots[i + 1] - inverseRoots[i]) / 1024);
	const scale = 2 ** shift;
	target[offset] = multiply(Math.floor(x / scale), reciprocal) / divisor;
	target[offset + 1] = multiply(Math.floor(y / scale), reciprocal) / divisor;
	target[offset + 2] = multiply(Math.floor(z / scale), reciprocal) / divisor;
	return target;
}

// 0x409899–0x409bce copies normal-derived color/UV values between cube faces.
// These two edge runs and three corners per face express all 342 copies.
export function blobSeamSources() {
	const result = [];
	const right = [[870,29],[1709,-1],[3391,-1],[3393,29],[868,-1],[1711,29]];
	const bottom = [[4988,-29],[4206,1],[2524,1],[783,-29],[1,1],[3306,-29]];
	const corners = [[56,784,810],[897,1625,1651],[1738,2466,2492],[3364,3307,0],[897,0,4174],[1682,3307,5015]];
	for (let face = 0; face < 6; face++) {
		const offset = face * 841;
		for (let i = 0; i < 27; i++) {
			result.push([offset + (i + 1) * 29 + 28, right[face][0] + i * right[face][1]]);
			result.push([offset + 813 + i, bottom[face][0] + i * bottom[face][1]]);
		}
		for (const [i, vertex] of [28,812,840].entries()) result.push([offset + vertex, corners[face][i]]);
	}
	return result;
}
const blobSeams = blobSeamSources();

// 0x408490 (tube) and 0x4094de (blob): one forward-difference normal at
// each grid vertex, rather than an average of the surrounding triangle normals.
export function updateComicNormals(geometry, columns, rows, faces = 1) {
	const fixedPositions = geometry.userData.nativePositions;
	const positions = fixedPositions || geometry.attributes.position.array;
	let attribute = geometry.attributes.normal;
	if (!attribute) {
		attribute = new THREE.BufferAttribute(new Float32Array(positions.length), 3).setUsage(THREE.DynamicDrawUsage);
		geometry.setAttribute('normal', attribute);
	}
	const normals = attribute.array, stride = columns + 1, faceSize = stride * (rows + 1);
	// Comic positions are stored in original world units / 1024.
	const edgeScale = (fixedPositions ? 1 : 67108864) / (faces === 1 ? 4 : 64);
	const a = [], b = [];
	for (let face = 0; face < faces; face++) for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
		const index = (face * faceSize + y * stride + x) * 3;
		for (let c = 0; c < 3; c++) {
			a[c] = Math.floor((positions[index + stride * 3 + c] - positions[index + c]) * edgeScale);
			b[c] = Math.floor((positions[index + 3 + c] - positions[index + c]) * edgeScale);
		}
		normalizeFixed(
			(multiply(a[1], b[2]) - multiply(a[2], b[1])) | 0,
			(multiply(a[2], b[0]) - multiply(a[0], b[2])) | 0,
			(multiply(a[0], b[1]) - multiply(a[1], b[0])) | 0,
			normals, index, 65536
		);
	}
	const copy = (destination, source) => {
		for (let c = 0; c < 3; c++) normals[destination * 3 + c] = normals[source * 3 + c];
	};
	if (faces === 6) {
		for (const [destination, source] of blobSeams) copy(destination, source);
	} else {
		// The tube closes each ring by copying its first vertex's lighting.
		for (let y = 0; y < rows; y++) copy(y * stride + columns, y * stride);
		// The final, almost collapsed row has unwritten native lighting.
		// Use its preceding ring deterministically instead of stale buffer data.
		for (let x = 0; x <= columns; x++) copy(rows * stride + x, (rows - 1) * stride + x);
	}
	attribute.needsUpdate = true;
}
