import { Object3D } from '../../../../src/core/Object3D.js';
import { Mesh } from '../../../../src/objects/Mesh.js';
import { Raycaster } from '../../../../src/core/Raycaster.js';
import { PlaneGeometry } from '../../../../src/geometries/PlaneGeometry.js';
import { BoxGeometry } from '../../../../src/geometries/BoxGeometry.js';
import { MeshBasicMaterial } from '../../../../src/materials/MeshBasicMaterial.js';
import { BufferGeometry } from '../../../../src/core/BufferGeometry.js';
import { Float32BufferAttribute } from '../../../../src/core/BufferAttribute.js';
import { Vector2 } from '../../../../src/math/Vector2.js';
import { Vector3 } from '../../../../src/math/Vector3.js';
import { Triangle } from '../../../../src/math/Triangle.js';
import { PerspectiveCamera } from '../../../../src/cameras/PerspectiveCamera.js';
import { AnimationClip } from '../../../../src/animation/AnimationClip.js';
import { AnimationMixer } from '../../../../src/animation/AnimationMixer.js';
import { NumberKeyframeTrack } from '../../../../src/animation/tracks/NumberKeyframeTrack.js';
import { DoubleSide, LoopOnce } from '../../../../src/constants.js';
import { Material } from '../../../../src/materials/Material.js';

// A unit quad in the XY plane with UVs that match its rest shape. Its second
// diagonal splits the quad into the triangles ( 0, 1, 2 ) and ( 0, 2, 3 ).

const QUAD_POSITION = [ - 1, - 1, 0, 1, - 1, 0, 1, 1, 0, - 1, 1, 0 ];
const QUAD_UV = [ 0, 0, 1, 0, 1, 1, 0, 1 ];
const QUAD_INDEX = [ 0, 1, 2, 0, 2, 3 ];

// The same three facial expressions stored in the two supported ways: as
// absolute target positions or as offsets relative to the rest shape. Both
// representations describe an identical deformation for a given weight.
//
// - smile moves the bottom left corner in the XY plane towards x = 0.
// - blink lifts the bottom left corner out of the plane towards z = weight.
// - squint squeezes the top right corner from x = 1 to x = 0.25 in the plane.

const MORPH_TARGETS = {
	absolute: {
		smile: [ 0, - 1, 0, 1, - 1, 0, 1, 1, 0, - 1, 1, 0 ],
		blink: [ - 1, - 1, 1, 1, - 1, 0, 1, 1, 0, - 1, 1, 0 ],
		squint: [ - 1, - 1, 0, 1, - 1, 0, 0.25, 1, 0, - 1, 1, 0 ]
	},
	relative: {
		smile: [ 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 ],
		blink: [ 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0 ],
		squint: [ 0, 0, 0, 0, 0, 0, - 0.75, 0, 0, 0, 0, 0 ]
	}
};

const MORPH_EPSILON = 1e-9;

function assertClose( assert, actual, expected, message ) {

	assert.ok(
		Math.abs( actual - expected ) <= MORPH_EPSILON,
		`${message}: expected ${expected}, got ${actual}`
	);

}

function createDeformedQuadGeometry( representation, expressions, indexed = true ) {

	const geometry = new BufferGeometry();

	if ( indexed ) {

		geometry.setAttribute( 'position', new Float32BufferAttribute( QUAD_POSITION.slice(), 3 ) );
		geometry.setAttribute( 'uv', new Float32BufferAttribute( QUAD_UV.slice(), 2 ) );
		geometry.setIndex( QUAD_INDEX.slice() );

	} else {

		const position = [];
		const uv = [];

		for ( let i = 0; i < QUAD_INDEX.length; i ++ ) {

			const vertex = QUAD_INDEX[ i ];

			position.push( QUAD_POSITION[ vertex * 3 ], QUAD_POSITION[ vertex * 3 + 1 ], QUAD_POSITION[ vertex * 3 + 2 ] );
			uv.push( QUAD_UV[ vertex * 2 ], QUAD_UV[ vertex * 2 + 1 ] );

		}

		geometry.setAttribute( 'position', new Float32BufferAttribute( position, 3 ) );
		geometry.setAttribute( 'uv', new Float32BufferAttribute( uv, 2 ) );

	}

	if ( expressions.length > 0 ) {

		geometry.morphAttributes.position = expressions.map( ( name ) => {

			const target = MORPH_TARGETS[ representation ][ name ];
			const array = [];

			if ( indexed ) {

				array.push( ...target );

			} else {

				for ( let i = 0; i < QUAD_INDEX.length; i ++ ) {

					const vertex = QUAD_INDEX[ i ];
					array.push( target[ vertex * 3 ], target[ vertex * 3 + 1 ], target[ vertex * 3 + 2 ] );

				}

			}

			const attribute = new Float32BufferAttribute( array, 3 );
			attribute.name = name;

			return attribute;

		} );

		geometry.morphTargetsRelative = representation === 'relative';

	}

	return geometry;

}

function createDeformedQuad( representation, expressions, influences, indexed = true ) {

	const geometry = createDeformedQuadGeometry( representation, expressions, indexed );
	const mesh = new Mesh( geometry, new MeshBasicMaterial( { side: DoubleSide } ) );

	for ( const name in influences ) {

		mesh.morphTargetInfluences[ mesh.morphTargetDictionary[ name ] ] = influences[ name ];

	}

	mesh.updateMatrixWorld( true );

	return mesh;

}

function castRay( mesh, x, y = 0.5 ) {

	const raycaster = new Raycaster( new Vector3( x, y, 5 ), new Vector3( 0, 0, - 1 ) );

	return raycaster.intersectObject( mesh );

}

// Analytic sample of the deformed quad for a ray along -Z hitting ( x, 0.5 ).
// The barycentric weight of the bottom left corner is ( 1 - x ) / ( 2 - smile ).
// UVs are fixed to the rest mapping, so uv.x = 1 - weight and uv.y = 0.75.

function getExpectedSample( smile, blink, x ) {

	const cornerWeight = ( 1 - x ) / ( 2 - smile );

	return {
		cornerWeight: cornerWeight,
		uv: new Vector2( 1 - cornerWeight, 0.75 ),
		z: cornerWeight * blink,
		distance: 5 - cornerWeight * blink
	};

}

export default QUnit.module( 'Objects', () => {

	QUnit.module( 'Mesh', () => {

		// INHERITANCE
		QUnit.test( 'Extending', ( assert ) => {

			const mesh = new Mesh();
			assert.strictEqual(
				mesh instanceof Object3D, true,
				'Mesh extends from Object3D'
			);

		} );

		// INSTANCING
		QUnit.test( 'Instancing', ( assert ) => {

			const object = new Mesh();
			assert.ok( object, 'Can instantiate a Mesh.' );

		} );

		// PROPERTIES
		QUnit.test( 'type', ( assert ) => {

			const object = new Mesh();
			assert.ok(
				object.type === 'Mesh',
				'Mesh.type should be Mesh'
			);

		} );

		// PUBLIC
		QUnit.test( 'isMesh', ( assert ) => {

			const object = new Mesh();
			assert.ok(
				object.isMesh,
				'Mesh.isMesh should be true'
			);

		} );

		QUnit.test( 'copy/material', ( assert ) => {

			// Material arrays are cloned
			const mesh1 = new Mesh();
			mesh1.material = [ new Material() ];

			const copy1 = mesh1.clone();
			assert.notStrictEqual( mesh1.material, copy1.material );

			// Non arrays are not cloned
			const mesh2 = new Mesh();
			mesh1.material = new Material();
			const copy2 = mesh2.clone();
			assert.strictEqual( mesh2.material, copy2.material );

		} );

		QUnit.todo( 'raycast', ( assert ) => {

			const geometry = new PlaneGeometry();
			const material = new MeshBasicMaterial();

			const mesh = new Mesh( geometry, material );

			const raycaster = new Raycaster();
			raycaster.ray.origin.set( 0.25, 0.25, 1 );
			raycaster.ray.direction.set( 0, 0, - 1 );

			const intersections = [];

			mesh.raycast( raycaster, intersections );

			const intersection = intersections[ 0 ];

			assert.equal( intersection.object, mesh, 'intersection object' );
			assert.equal( intersection.distance, 1, 'intersection distance' );
			assert.equal( intersection.faceIndex, 1, 'intersection face index' );
			assert.deepEqual( intersection.face, { a: 0, b: 2, c: 1 }, 'intersection vertex indices' );
			assert.deepEqual( intersection.point, new Vector3( 0.25, 0.25, 0 ), 'intersection point' );
			assert.deepEqual( intersection.uv, new Vector2( 0.75, 0.75 ), 'intersection uv' );

		} );

		QUnit.test( 'raycast/range', ( assert ) => {

			const geometry = new BoxGeometry( 1, 1, 1 );
			const material = new MeshBasicMaterial( { side: DoubleSide } );
			const mesh = new Mesh( geometry, material );
			const raycaster = new Raycaster();
			const intersections = [];

			raycaster.ray.origin.set( 0, 0, 0 );
			raycaster.ray.direction.set( 1, 0, 0 );
			raycaster.near = 100;
			raycaster.far = 200;

			mesh.matrixWorld.identity();
			mesh.position.setX( 150 );
			mesh.updateMatrixWorld( true );
			intersections.length = 0;
			mesh.raycast( raycaster, intersections );
			assert.ok( intersections.length > 0, 'bounding sphere between near and far' );

			mesh.matrixWorld.identity();
			mesh.position.setX( raycaster.near );
			mesh.updateMatrixWorld( true );
			intersections.length = 0;
			mesh.raycast( raycaster, intersections );
			assert.ok( intersections.length > 0, 'bounding sphere across near' );

			mesh.matrixWorld.identity();
			mesh.position.setX( raycaster.far );
			mesh.updateMatrixWorld( true );
			intersections.length = 0;
			mesh.raycast( raycaster, intersections );
			assert.ok( intersections.length > 0, 'bounding sphere across far' );

			mesh.matrixWorld.identity();
			mesh.position.setX( 150 );
			mesh.scale.setY( 9999 );
			mesh.updateMatrixWorld( true );
			intersections.length = 0;
			mesh.raycast( raycaster, intersections );
			assert.ok( intersections.length > 0, 'bounding sphere across near and far' );

			mesh.matrixWorld.identity();
			mesh.position.setX( - 9999 );
			mesh.updateMatrixWorld( true );
			intersections.length = 0;
			mesh.raycast( raycaster, intersections );
			assert.ok( intersections.length === 0, 'bounding sphere behind near' );

			mesh.matrixWorld.identity();
			mesh.position.setX( 9999 );
			mesh.updateMatrixWorld( true );
			intersections.length = 0;
			mesh.raycast( raycaster, intersections );
			assert.ok( intersections.length === 0, 'bounding sphere beyond far' );

		} );

		// MORPH TARGET PICKING

		QUnit.module( 'raycast/morph targets', () => {

			QUnit.test( 'hits the deformed surface, not the rest pose', ( assert ) => {

				for ( const representation of [ 'absolute', 'relative' ] ) {

					const mesh = createDeformedQuad( representation, [ 'blink' ], { blink: 1 } );

					// The rest quad lies at z = 0, the animated one is lifted to
					// z = 0.925 at this spot. The ray only hits the deformed surface.

					const restHits = castRay( createDeformedQuad( representation, [], {} ), - 0.85, - 0.9 );
					const hits = castRay( mesh, - 0.85, - 0.9 );

					assert.strictEqual( restHits.length, 1, `${representation}: rest quad is hit` );
					assertClose( assert, restHits[ 0 ].point.z, 0, `${representation}: rest hit lies at z = 0` );

					assert.strictEqual( hits.length, 1, `${representation}: animated quad is hit exactly once` );

					const hit = hits[ 0 ];

					assert.strictEqual( hit.faceIndex, 0, `${representation}: hit face index` );
					assert.deepEqual(
						[ hit.face.a, hit.face.b, hit.face.c ], [ 0, 1, 2 ],
						`${representation}: hit face uses the vertices of the deformed triangle`
					);

					assertClose( assert, hit.point.x, - 0.85, `${representation}: hit point x` );
					assertClose( assert, hit.point.y, - 0.9, `${representation}: hit point y` );
					assertClose( assert, hit.point.z, 0.925, `${representation}: hit point z is on the animated surface` );
					assertClose( assert, hit.distance, 4.075, `${representation}: hit distance` );

					assertClose( assert, hit.uv.x, 0.075, `${representation}: hit uv.x` );
					assertClose( assert, hit.uv.y, 0.05, `${representation}: hit uv.y` );

				}

			} );

			QUnit.test( 'absolute targets and relative offsets pick the same surface', ( assert ) => {

				const weights = [[ 0, 0 ], [ 1, 0 ], [ 0, 1 ], [ 0.25, 0.5 ], [ 0.5, 0.5 ], [ 0.75, 0.25 ], [ 1, 1 ]];

				for ( const [ smile, blink ] of weights ) {

					const absoluteHits = castRay( createDeformedQuad( 'absolute', [ 'smile', 'blink' ], { smile, blink } ), 0.8 );
					const relativeHits = castRay( createDeformedQuad( 'relative', [ 'smile', 'blink' ], { smile, blink } ), 0.8 );

					assert.strictEqual( absoluteHits.length, 1, `absolute ( ${smile}, ${blink} ): one hit` );
					assert.strictEqual( relativeHits.length, 1, `relative ( ${smile}, ${blink} ): one hit` );

					const absolute = absoluteHits[ 0 ];
					const relative = relativeHits[ 0 ];

					assert.strictEqual( absolute.faceIndex, relative.faceIndex, `( ${smile}, ${blink} ): same face index` );
					assert.ok( absolute.point.distanceTo( relative.point ) <= MORPH_EPSILON, `( ${smile}, ${blink} ): same hit point` );
					assert.ok( absolute.uv.distanceTo( relative.uv ) <= MORPH_EPSILON, `( ${smile}, ${blink} ): same uv` );
					assertClose( assert, absolute.distance, relative.distance, `( ${smile}, ${blink} ): same distance` );

				}

			} );

			QUnit.test( 'texture coordinates follow the animated triangle', ( assert ) => {

				const samples = [[ 0.5, 0.5 ], [ 0.25, 1 ], [ 1, 0.25 ]];

				for ( const [ smile, blink ] of samples ) {

					for ( const representation of [ 'absolute', 'relative' ] ) {

						const label = `${representation} ( ${smile}, ${blink} )`;
						const mesh = createDeformedQuad( representation, [ 'smile', 'blink' ], { smile, blink } );
						const hits = castRay( mesh, 0.8 );

						assert.strictEqual( hits.length, 1, `${label}: one hit` );

						const hit = hits[ 0 ];
						const localPoint = mesh.worldToLocal( hit.point.clone() );

						// Reconstruct the vertices that the picker reported for the face
						// through getVertexPosition(), i.e. the animated triangle.

						const a = mesh.getVertexPosition( hit.face.a, new Vector3() );
						const b = mesh.getVertexPosition( hit.face.b, new Vector3() );
						const c = mesh.getVertexPosition( hit.face.c, new Vector3() );

						const barycoord = Triangle.getBarycoord( localPoint, a, b, c, new Vector3() );
						const uv = Triangle.getInterpolatedAttribute( mesh.geometry.attributes.uv, hit.face.a, hit.face.b, hit.face.c, barycoord, new Vector2() );

						const reconstructed = new Vector3()
							.addScaledVector( a, barycoord.x )
							.addScaledVector( b, barycoord.y )
							.addScaledVector( c, barycoord.z );

						assert.ok( reconstructed.distanceTo( localPoint ) <= MORPH_EPSILON, `${label}: hit point lies on the animated triangle` );
						assert.ok( uv.distanceTo( hit.uv ) <= MORPH_EPSILON, `${label}: hit uv matches the animated triangle` );

						// The sampled uv must also match the analytic mapping of the
						// deformed surface, so that a UV lookup resolves to the same texel
						// that is rendered at the hit point.

						const expected = getExpectedSample( smile, blink, 0.8 );

						assertClose( assert, hit.uv.x, expected.uv.x, `${label}: hit uv.x follows the deformation` );
						assertClose( assert, hit.uv.y, expected.uv.y, `${label}: hit uv.y follows the deformation` );
						assertClose( assert, localPoint.z, expected.z, `${label}: hit point lies on the deformed surface` );

					}

				}

			} );

			QUnit.test( 'multiple expressions keep their own weights', ( assert ) => {

				const x = 0.8;

				for ( const representation of [ 'absolute', 'relative' ] ) {

					// Holding the smile weight fixed while the blink weight changes
					// must only change the out-of-plane deformation, not the UVs.

					const base = castRay( createDeformedQuad( representation, [ 'smile', 'blink' ], { smile: 0.25, blink: 0 } ), x )[ 0 ];

					for ( const blink of [ 0, 0.5, 1 ] ) {

						const label = `${representation}: smile 0.25, blink ${blink}`;
						const hit = castRay( createDeformedQuad( representation, [ 'smile', 'blink' ], { smile: 0.25, blink } ), x )[ 0 ];
						const expected = getExpectedSample( 0.25, blink, x );

						assertClose( assert, hit.uv.x, base.uv.x, `${label}: uv.x is independent of blink` );
						assertClose( assert, hit.uv.y, base.uv.y, `${label}: uv.y is independent of blink` );
						assertClose( assert, hit.point.z, expected.z, `${label}: z reflects the blink weight` );
						assertClose( assert, hit.distance, expected.distance, `${label}: distance reflects the blink weight` );

					}

					// Changing the smile weight moves the UVs but, at a fixed blink
					// weight, must not change the out-of-plane amount of the corner.

					for ( const smile of [ 0, 0.25, 0.75 ] ) {

						const label = `${representation}: smile ${smile}, blink 0.5`;
						const hit = castRay( createDeformedQuad( representation, [ 'smile', 'blink' ], { smile, blink: 0.5 } ), x )[ 0 ];
						const expected = getExpectedSample( smile, 0.5, x );

						assertClose( assert, hit.uv.x, expected.uv.x, `${label}: uv.x reflects the smile weight` );
						assertClose( assert, hit.point.z, expected.z, `${label}: z reflects both weights` );

					}

				}

			} );

			QUnit.test( 'in-plane deformation changes the picked face and its uv', ( assert ) => {

				for ( const representation of [ 'absolute', 'relative' ] ) {

					const restMesh = createDeformedQuad( representation, [], {} );
					const mesh = createDeformedQuad( representation, [ 'squint' ], { squint: 1 } );

					// At ( 0.1, 0.5 ) the rest quad belongs to the second triangle with
					// uv.x = 0.55. The squint pulls the top right corner inwards, so the
					// first triangle now covers the point and maps to uv.x = 0.83125.

					const restHit = castRay( restMesh, 0.1 )[ 0 ];
					const hits = castRay( mesh, 0.1 );

					assert.strictEqual( restHit.faceIndex, 1, `${representation}: rest quad picks the second triangle` );
					assertClose( assert, restHit.uv.x, 0.55, `${representation}: rest uv` );

					assert.strictEqual( hits.length, 1, `${representation}: animated quad is hit` );
					assert.strictEqual( hits[ 0 ].faceIndex, 0, `${representation}: animated quad picks the first triangle` );
					assertClose( assert, hits[ 0 ].uv.x, 0.83125, `${representation}: animated uv.x` );
					assertClose( assert, hits[ 0 ].uv.y, 0.75, `${representation}: animated uv.y` );
					assertClose( assert, hits[ 0 ].point.z, 0, `${representation}: in-plane deformation stays at z = 0` );

					// The corner area that the rest quad covered at ( 0.9, 0.5 ) has been
					// squeezed away, so a ray there must no longer hit the animated quad
					// even though its rest pose was hit.

					assert.strictEqual( castRay( restMesh, 0.9 ).length, 1, `${representation}: rest quad is hit at ( 0.9, 0.5 )` );
					assert.strictEqual( castRay( mesh, 0.9 ).length, 0, `${representation}: animated quad is no longer hit at ( 0.9, 0.5 )` );

				}

			} );

			QUnit.test( 'non-indexed geometry picks the deformed surface', ( assert ) => {

				for ( const representation of [ 'absolute', 'relative' ] ) {

					const indexedHit = castRay( createDeformedQuad( representation, [ 'smile', 'blink' ], { smile: 0.5, blink: 0.5 } ), 0.8 )[ 0 ];
					const hits = castRay( createDeformedQuad( representation, [ 'smile', 'blink' ], { smile: 0.5, blink: 0.5 }, false ), 0.8 );
					const expected = getExpectedSample( 0.5, 0.5, 0.8 );

					assert.strictEqual( hits.length, 1, `${representation}: one hit on non-indexed geometry` );

					const hit = hits[ 0 ];

					assert.strictEqual( hit.faceIndex, 0, `${representation}: non-indexed face index` );
					assert.deepEqual(
						[ hit.face.a, hit.face.b, hit.face.c ], [ 0, 1, 2 ],
						`${representation}: non-indexed face reports vertex indices`
					);

					assertClose( assert, hit.point.z, expected.z, `${representation}: non-indexed hit point z` );
					assertClose( assert, hit.uv.x, expected.uv.x, `${representation}: non-indexed hit uv.x` );
					assertClose( assert, hit.uv.y, expected.uv.y, `${representation}: non-indexed hit uv.y` );

					assert.ok( hit.point.distanceTo( indexedHit.point ) <= MORPH_EPSILON, `${representation}: indexed and non-indexed hit point agree` );
					assert.ok( hit.uv.distanceTo( indexedHit.uv ) <= MORPH_EPSILON, `${representation}: indexed and non-indexed uv agree` );

				}

			} );

			QUnit.test( 'picking through a camera matches the deformed screen position', ( assert ) => {

				for ( const representation of [ 'absolute', 'relative' ] ) {

					const mesh = createDeformedQuad( representation, [ 'smile', 'blink' ], { smile: 0.5, blink: 0.5 } );

					mesh.position.set( 2, 1, - 3 );
					mesh.rotation.set( 0.3, 0.5, 0 );
					mesh.scale.setScalar( 1.5 );
					mesh.updateMatrixWorld( true );

					const camera = new PerspectiveCamera( 45, 1, 0.1, 100 );
					camera.position.set( 2, 1, 0 );
					camera.lookAt( 2, 1, - 3 );
					camera.updateMatrixWorld( true );
					camera.updateProjectionMatrix();

					const expected = getExpectedSample( 0.5, 0.5, 0.8 );
					const worldPoint = new Vector3( 0.8, 0.5, expected.z ).applyMatrix4( mesh.matrixWorld );
					const ndc = worldPoint.clone().project( camera );

					const raycaster = new Raycaster();
					raycaster.setFromCamera( { x: ndc.x, y: ndc.y }, camera );

					const hits = raycaster.intersectObject( mesh );

					assert.strictEqual( hits.length, 1, `${representation}: clicked pixel hits the animated quad once` );

					const hit = hits[ 0 ];

					assert.ok( hit.point.distanceTo( worldPoint ) <= MORPH_EPSILON, `${representation}: click hits the deformed world point` );
					assertClose( assert, hit.uv.x, expected.uv.x, `${representation}: clicked uv.x` );
					assertClose( assert, hit.uv.y, expected.uv.y, `${representation}: clicked uv.y` );
					assertClose( assert, hit.distance, raycaster.ray.origin.distanceTo( worldPoint ), `${representation}: clicked distance` );

					// The same world point is also visible at that pixel.

					const reprojected = hit.point.clone().project( camera );

					assertClose( assert, reprojected.x, ndc.x, `${representation}: hit point reprojects onto the clicked pixel (x)` );
					assertClose( assert, reprojected.y, ndc.y, `${representation}: hit point reprojects onto the clicked pixel (y)` );

					// Clicking the pixel where the rest pose would be seen must pick a
					// different surface point and UV, proving the deformed surface is used.

					const restNdc = new Vector3( 0.8, 0.5, 0 ).applyMatrix4( mesh.matrixWorld ).project( camera );
					const restRaycaster = new Raycaster();
					restRaycaster.setFromCamera( { x: restNdc.x, y: restNdc.y }, camera );

					const restHit = restRaycaster.intersectObject( mesh )[ 0 ];

					assert.ok( restHit !== undefined, `${representation}: rest pixel still hits the animated quad` );
					assert.ok( Math.abs( restHit.uv.x - expected.uv.x ) > 1e-3, `${representation}: rest pixel maps to a different uv` );

				}

			} );

			QUnit.test( 'bounds are computed from the morph targets', ( assert ) => {

				for ( const representation of [ 'absolute', 'relative' ] ) {

					const mesh = createDeformedQuad( representation, [ 'blink' ], { blink: 1 } );

					mesh.geometry.computeBoundingBox();
					mesh.geometry.computeBoundingSphere();

					// The blink target lifts the corner by one unit, so the bounds have to
					// grow with the morph target even though the rest quad lies at z = 0.

					assertClose( assert, mesh.geometry.boundingBox.max.z, 1, `${representation}: bounding box covers the target` );
					assertClose( assert, mesh.geometry.boundingSphere.radius, 1.5, `${representation}: bounding sphere covers the targets` );

					// The corner is now outside the rest silhouette, so a hit there is only
					// possible because the bounds and the face test use the targets.

					const hits = castRay( mesh, - 0.85, - 0.9 );

					assert.strictEqual( hits.length, 1, `${representation}: far corner of the animated quad is pickable` );
					assertClose( assert, hits[ 0 ].point.z, 0.925, `${representation}: far corner hit lies on the target` );

				}

			} );

			QUnit.test( 'animating weights through an AnimationMixer updates picking', ( assert ) => {

				for ( const representation of [ 'absolute', 'relative' ] ) {

					const mesh = createDeformedQuad( representation, [ 'smile', 'blink' ], {} );

					assert.deepEqual( mesh.morphTargetDictionary, { smile: 0, blink: 1 }, `${representation}: expression names resolve to morph target indices` );

					const clip = new AnimationClip( 'face', 1, [
						new NumberKeyframeTrack( '.morphTargetInfluences[smile]', [ 0, 1 ], [ 0, 1 ] ),
						new NumberKeyframeTrack( '.morphTargetInfluences[blink]', [ 0, 1 ], [ 1, 0 ] )
					] );

					const mixer = new AnimationMixer( mesh );
					const action = mixer.clipAction( clip );
					action.setLoop( LoopOnce, 1 );
					action.clampWhenFinished = true;
					action.play();

					for ( const time of [ 0, 0.25, 0.5, 0.75, 1 ] ) {

						mixer.setTime( time );

						const smile = mesh.morphTargetInfluences[ mesh.morphTargetDictionary.smile ];
						const blink = mesh.morphTargetInfluences[ mesh.morphTargetDictionary.blink ];

						assertClose( assert, smile, time, `${representation}: smile weight at ${time}s` );
						assertClose( assert, blink, 1 - time, `${representation}: blink weight at ${time}s` );

						const expected = getExpectedSample( time, 1 - time, 0.8 );
						const hits = castRay( mesh, 0.8 );

						assert.strictEqual( hits.length, 1, `${representation}: one hit at ${time}s` );
						assertClose( assert, hits[ 0 ].point.z, expected.z, `${representation}: hit z at ${time}s` );
						assertClose( assert, hits[ 0 ].uv.x, expected.uv.x, `${representation}: hit uv.x at ${time}s` );
						assertClose( assert, hits[ 0 ].distance, expected.distance, `${representation}: hit distance at ${time}s` );

					}

					mixer.stopAllAction();

				}

			} );

		} );

	} );

} );
