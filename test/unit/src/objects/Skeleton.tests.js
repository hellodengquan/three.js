import { Skeleton } from '../../../../src/objects/Skeleton.js';
import { Bone } from '../../../../src/objects/Bone.js';
import { SkinnedMesh } from '../../../../src/objects/SkinnedMesh.js';
import { BufferGeometry } from '../../../../src/core/BufferGeometry.js';
import { BufferAttribute } from '../../../../src/core/BufferAttribute.js';
import { Matrix4 } from '../../../../src/math/Matrix4.js';
import { Vector3 } from '../../../../src/math/Vector3.js';
import { Vector4 } from '../../../../src/math/Vector4.js';

const tolerance = 1e-6;

function vec3Equals( a, b, tolerance ) {

	return a.distanceTo( b ) <= tolerance;

}

function vec4Equals( a, b, tolerance ) {

	return Math.abs( a.x - b.x ) <= tolerance &&
		Math.abs( a.y - b.y ) <= tolerance &&
		Math.abs( a.z - b.z ) <= tolerance &&
		Math.abs( a.w - b.w ) <= tolerance;

}

// Reads the 4x4 matrix of a single bone back out of the bone texture.
// One matrix is stored as four consecutive RGBA texels (16 floats).
function readBoneMatrix( skeleton, boneIndex ) {

	return new Matrix4().fromArray( skeleton.boneTexture.image.data, boneIndex * 16 );

}

// Builds a two-bone chain (root at the origin, child offset along +X) whose
// bind pose is captured in the skeleton's inverse matrices.
function createHierarchy() {

	const root = new Bone();
	root.position.set( 0, 0, 0 );

	const child = new Bone();
	child.position.set( 2, 0, 0 );
	root.add( child );

	root.updateMatrixWorld( true );

	const skeleton = new Skeleton( [ root, child ] );
	skeleton.update();
	skeleton.computeBoneTexture();

	return { root, child, skeleton };

}

export default QUnit.module( 'Objects', () => {

	QUnit.module( 'Skeleton', () => {

		// INSTANCING
		QUnit.test( 'Instancing', ( assert ) => {

			const object = new Skeleton();
			assert.ok( object, 'Can instantiate a Skeleton.' );

		} );

		// PUBLIC

		QUnit.test( 'dispose', ( assert ) => {

			assert.expect( 0 );

			const object = new Skeleton();
			object.dispose();

		} );

		QUnit.test( 'computeBoneTexture: same texture serves bind pose and motion pose', ( assert ) => {

			const { root, child, skeleton } = createHierarchy();
			const texture = skeleton.boneTexture;

			assert.ok( texture !== null, 'computeBoneTexture creates a bone texture.' );
			assert.strictEqual(
				texture.image.data, skeleton.boneMatrices,
				'The texture shares the skeleton bone matrix buffer.'
			);

			// In the bind pose every bone offset matrix (world * inverseBind) is identity.
			assert.ok(
				readBoneMatrix( skeleton, 0 ).equals( new Matrix4() ),
				'Root joint contributes the identity transform in the bind pose.'
			);
			assert.ok(
				readBoneMatrix( skeleton, 1 ).equals( new Matrix4() ),
				'Child joint contributes the identity transform in the bind pose.'
			);

			// Move the hierarchy: rotate the root and the child, then refresh the
			// skeleton without rebuilding the texture.
			root.rotation.z = Math.PI / 2;
			child.rotation.z = Math.PI / 2;
			root.updateMatrixWorld( true );
			skeleton.update();

			assert.strictEqual(
				skeleton.boneTexture, texture,
				'The motion pose is written into the same texture instance as the bind pose.'
			);

			const rootOffset = readBoneMatrix( skeleton, 0 );
			const childOffset = readBoneMatrix( skeleton, 1 );

			// Root: a +90 degree turn about Z. Its bind origin stays put while the +X
			// direction rotates onto +Y. A w=0 vector isolates the rotation, dropping the
			// translation part of the offset matrix.
			assert.ok(
				vec3Equals(
					new Vector3( 0, 0, 0 ).applyMatrix4( rootOffset ),
					new Vector3( 0, 0, 0 ), tolerance
				),
				'Root joint keeps its bind origin at the origin after rotating.'
			);
			assert.ok(
				vec4Equals(
					new Vector4( 1, 0, 0, 0 ).applyMatrix4( rootOffset ),
					new Vector4( 0, 1, 0, 0 ), tolerance
				),
				'Root joint transform rotates the +X direction onto +Y.'
			);

			// Child: the parent rotation propagates down the chain. The child's bind
			// position (2, 0, 0) is carried to (0, 2, 0), and its local +X direction
			// undergoes the parent's 90 degree turn plus its own, a total of 180 degrees.
			assert.ok(
				vec3Equals(
					new Vector3( 2, 0, 0 ).applyMatrix4( childOffset ),
					new Vector3( 0, 2, 0 ), tolerance
				),
				'Child joint transform reflects the parent motion: bind position (2, 0, 0) moves to (0, 2, 0).'
			);
			assert.ok(
				vec4Equals(
					new Vector4( 1, 0, 0, 0 ).applyMatrix4( childOffset ),
					new Vector4( - 1, 0, 0, 0 ), tolerance
				),
				'Child joint transform combines the parent rotation with its own: the +X direction rotates 180 degrees onto -X.'
			);

		} );

		QUnit.test( 'boneTexture: two-joint vertex matches the skinned mesh position', ( assert ) => {

			const { root, child, skeleton } = createHierarchy();

			// A single vertex weighted 50/50 between the root (joint 0) and the child (joint 1).
			const geometry = new BufferGeometry();
			geometry.setAttribute( 'position', new BufferAttribute( new Float32Array( [ 1, 0, 0 ] ), 3 ) );
			geometry.setAttribute( 'skinIndex', new BufferAttribute( new Uint16Array( [ 0, 1, 0, 0 ] ), 4 ) );
			geometry.setAttribute( 'skinWeight', new BufferAttribute( new Float32Array( [ 0.5, 0.5, 0, 0 ] ), 4 ) );

			const mesh = new SkinnedMesh( geometry );
			mesh.bind( skeleton );

			// Blends the vertex with the offset matrices decoded from the texture, the
			// same weighted sum the vertex shader performs.
			function textureSkinnedPosition() {

				const rootOffset = readBoneMatrix( skeleton, 0 );
				const childOffset = readBoneMatrix( skeleton, 1 );
				const bindPosition = new Vector3( 1, 0, 0 );

				return new Vector3()
					.addScaledVector( bindPosition.clone().applyMatrix4( rootOffset ), 0.5 )
					.addScaledVector( bindPosition.clone().applyMatrix4( childOffset ), 0.5 );

			}

			// Bind pose: both offset matrices are identity, so the vertex stays put.
			skeleton.update();
			assert.ok(
				vec3Equals(
					textureSkinnedPosition(),
					mesh.getVertexPosition( 0, new Vector3() ), tolerance
				),
				'Bind pose: the texture expression equals the skinned mesh position.'
			);
			assert.ok(
				vec3Equals( textureSkinnedPosition(), new Vector3( 1, 0, 0 ), tolerance ),
				'Bind pose: the two-joint vertex remains at its rest position (1, 0, 0).'
			);

			// Motion pose: parent motion propagates to the child bone.
			root.rotation.z = Math.PI / 2;
			child.rotation.z = Math.PI / 2;
			root.updateMatrixWorld( true );
			skeleton.update();

			assert.ok(
				vec3Equals(
					textureSkinnedPosition(),
					mesh.getVertexPosition( 0, new Vector3() ), tolerance
				),
				'Motion pose: the texture expression equals the skinned mesh position of the two-joint vertex.'
			);

		} );

	} );

} );
