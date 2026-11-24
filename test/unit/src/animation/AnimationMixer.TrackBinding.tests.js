import { AnimationMixer } from '../../../../src/animation/AnimationMixer.js';
import { AnimationClip } from '../../../../src/animation/AnimationClip.js';
import { NumberKeyframeTrack } from '../../../../src/animation/tracks/NumberKeyframeTrack.js';
import { QuaternionKeyframeTrack } from '../../../../src/animation/tracks/QuaternionKeyframeTrack.js';

import { SkinnedMesh } from '../../../../src/objects/SkinnedMesh.js';
import { Skeleton } from '../../../../src/objects/Skeleton.js';
import { Bone } from '../../../../src/objects/Bone.js';
import { Mesh } from '../../../../src/objects/Mesh.js';
import { Object3D } from '../../../../src/core/Object3D.js';
import { BufferGeometry } from '../../../../src/core/BufferGeometry.js';
import { Float32BufferAttribute } from '../../../../src/core/BufferAttribute.js';
import { Quaternion } from '../../../../src/math/Quaternion.js';

import { CONSOLE_LEVEL } from '../../utils/console-wrapper.js';

const CLIP_DURATION = 1;

// Keyframed rotations, kept as unit quaternions so the keyframe tracks stay valid.
const SPINE_FROM = new Quaternion().setFromAxisAngle( new Object3D().up, 0 );
const SPINE_TO = new Quaternion().setFromAxisAngle( new Object3D().up, Math.PI / 2 );
const ARM_FROM = new Quaternion().setFromAxisAngle( new Object3D().up, Math.PI );
const ARM_TO = new Quaternion().setFromAxisAngle( new Object3D().up, 3 * Math.PI / 2 );

// Values used by the named expression tracks.
const SMILE_FROM = 0.1, SMILE_TO = 0.9;
const FROWN_FROM = 0.2, FROWN_TO = 0.8;

// The same clip is handed to both the original model and the stunt double.
function createPerformanceClip() {

	const tracks = [

		new QuaternionKeyframeTrack(
			'Spine.quaternion',
			[ 0, CLIP_DURATION ],
			[ ...SPINE_FROM.toArray(), ...SPINE_TO.toArray() ]
		),

		new QuaternionKeyframeTrack(
			'Arm.quaternion',
			[ 0, CLIP_DURATION ],
			[ ...ARM_FROM.toArray(), ...ARM_TO.toArray() ]
		),

		new NumberKeyframeTrack(
			'Face.morphTargetInfluences[Smile]',
			[ 0, CLIP_DURATION ],
			[ SMILE_FROM, SMILE_TO ]
		),

		new NumberKeyframeTrack(
			'Face.morphTargetInfluences[Frown]',
			[ 0, CLIP_DURATION ],
			[ FROWN_FROM, FROWN_TO ]
		)

	];

	return new AnimationClip( 'performance', CLIP_DURATION, tracks );

}

function createFaceGeometry( expressionOrder ) {

	const geometry = new BufferGeometry();

	geometry.morphAttributes.position = expressionOrder.map( ( name ) => {

		const attribute = new Float32BufferAttribute( [ 0, 0, 0 ], 3 );
		attribute.name = name;
		return attribute;

	} );

	return geometry;

}

/**
 * Builds one of the two characters. Both use identical bone and expression
 * names, but each model may lay the expressions out in a different order, and
 * the stunt double may be missing a bone (the Arm channel then has no target).
 */
function createCharacter( { withArm = true, expressionOrder = [ 'Smile', 'Frown', 'Idle' ] } = {} ) {

	const root = new SkinnedMesh();

	const spine = new Bone();
	spine.name = 'Spine';
	root.add( spine );

	const arm = new Bone();
	arm.name = 'Arm';
	spine.add( arm );

	const bones = withArm ? [ spine, arm ] : [ spine ];
	root.bind( new Skeleton( bones ) );

	const face = new Mesh( createFaceGeometry( expressionOrder ) );
	face.name = 'Face';
	// An expression without a track keeps whatever value it started with.
	face.morphTargetInfluences[ face.morphTargetDictionary.Idle ] = 0.42;
	root.add( face );

	// Same-named prop on every character; it is not touched by the clip.
	const sword = new Object3D();
	sword.name = 'Sword';
	sword.rotation.y = 1.23;
	root.add( sword );

	return { root, spine, arm: withArm ? arm : null, face, sword };

}

// QuaternionKeyframeTrack interpolates with QuaternionLinearInterpolant,
// i.e. spherical linear interpolation between unit quaternions.
function expectedQuaternion( from, to, progress ) {

	return new Quaternion().slerpQuaternions( from, to, progress );

}

function expectedInfluence( from, to, progress ) {

	return from + ( to - from ) * progress;

}

function assertQuaternionClose( assert, actual, expected, message ) {

	// Compare components directly: both values are nearly unit quaternions,
	// where angleTo()'s acos() amplifies tiny floating point deltas.
	const a = actual.toArray();
	const b = expected.toArray();

	for ( let i = 0; i < 4; i ++ ) {

		assert.ok( Math.abs( a[ i ] - b[ i ] ) < 1e-6, message );

	}

}

export default QUnit.module( 'Animation', () => {

	QUnit.module( 'AnimationMixer: track binding', () => {

		QUnit.test( 'same clip drives two same-named characters at independent progress', ( assert ) => {

			// Each model stores the shared expressions in a different layout.
			const original = createCharacter( { expressionOrder: [ 'Smile', 'Frown', 'Idle' ] } );
			const stunt = createCharacter( { expressionOrder: [ 'Frown', 'Idle', 'Smile' ] } );

			const clip = createPerformanceClip();

			const mixerOriginal = new AnimationMixer( original.root );
			const mixerStunt = new AnimationMixer( stunt.root );

			const actionOriginal = mixerOriginal.clipAction( clip );
			const actionStunt = mixerStunt.clipAction( clip );

			actionOriginal.play();
			actionStunt.play();

			// The two characters advance to different points of the same performance.
			const progressOriginal = 0.3;
			const progressStunt = 0.7;

			mixerOriginal.update( progressOriginal );
			mixerStunt.update( progressStunt );

			// Bone poses come from each character's own progress.
			assertQuaternionClose(
				assert,
				original.spine.quaternion,
				expectedQuaternion( SPINE_FROM, SPINE_TO, progressOriginal ),
				'Original Spine pose is computed from its progress'
			);
			assertQuaternionClose(
				assert,
				stunt.spine.quaternion,
				expectedQuaternion( SPINE_FROM, SPINE_TO, progressStunt ),
				'Stunt Spine pose is computed from its progress'
			);
			assertQuaternionClose(
				assert,
				original.arm.quaternion,
				expectedQuaternion( ARM_FROM, ARM_TO, progressOriginal ),
				'Original Arm pose is computed from its progress'
			);
			assertQuaternionClose(
				assert,
				stunt.arm.quaternion,
				expectedQuaternion( ARM_FROM, ARM_TO, progressStunt ),
				'Stunt Arm pose is computed from its progress'
			);

			// Named expression weights resolve through each character's own
			// morphTargetDictionary, so layout differences do not mix them up.
			assert.numEqual(
				original.face.morphTargetInfluences[ original.face.morphTargetDictionary.Smile ],
				expectedInfluence( SMILE_FROM, SMILE_TO, progressOriginal ),
				'Original Smile weight is computed from its progress'
			);
			assert.numEqual(
				stunt.face.morphTargetInfluences[ stunt.face.morphTargetDictionary.Smile ],
				expectedInfluence( SMILE_FROM, SMILE_TO, progressStunt ),
				'Stunt Smile weight is computed from its progress despite the different layout'
			);
			assert.numEqual(
				original.face.morphTargetInfluences[ original.face.morphTargetDictionary.Frown ],
				expectedInfluence( FROWN_FROM, FROWN_TO, progressOriginal ),
				'Original Frown weight is computed from its progress'
			);
			assert.numEqual(
				stunt.face.morphTargetInfluences[ stunt.face.morphTargetDictionary.Frown ],
				expectedInfluence( FROWN_FROM, FROWN_TO, progressStunt ),
				'Stunt Frown weight is computed from its progress despite the different layout'
			);

			// Same-named props and expressions without a track keep their original values.
			assert.strictEqual( original.sword.rotation.y, 1.23, 'Same-named Sword prop on the original model is untouched' );
			assert.strictEqual( stunt.sword.rotation.y, 1.23, 'Same-named Sword prop on the stunt double is untouched' );
			assert.strictEqual(
				original.face.morphTargetInfluences[ original.face.morphTargetDictionary.Idle ],
				0.42,
				'Original Idle expression without a track keeps its value'
			);
			assert.strictEqual(
				stunt.face.morphTargetInfluences[ stunt.face.morphTargetDictionary.Idle ],
				0.42,
				'Stunt Idle expression without a track keeps its value'
			);

			// Advancing one mixer must not push the other character forward.
			mixerOriginal.update( 0.2 );
			assertQuaternionClose(
				assert,
				stunt.spine.quaternion,
				expectedQuaternion( SPINE_FROM, SPINE_TO, progressStunt ),
				'Stunt character is unaffected by updates of the original mixer'
			);

		} );

		QUnit.test( 'a channel missing on one model does not interrupt the other tracks', ( assert ) => {

			const original = createCharacter();
			// The stunt double's new skeleton has no Arm bone.
			const stunt = createCharacter( { withArm: false } );

			const clip = createPerformanceClip();

			const mixerOriginal = new AnimationMixer( original.root );
			const mixerStunt = new AnimationMixer( stunt.root );

			mixerOriginal.clipAction( clip ).play();
			mixerStunt.clipAction( clip ).play();

			// Binding the missing Arm channel only warns; silence it for this test.
			console.level = CONSOLE_LEVEL.OFF;

			try {

				mixerOriginal.update( 0.4 );
				mixerStunt.update( 0.6 );

				// Repeated updates prove the unavailable channel stays a no-op.
				mixerOriginal.update( 0.1 );
				mixerStunt.update( 0.1 );

			} finally {

				console.level = CONSOLE_LEVEL.DEFAULT;

			}

			// The stunt double still plays every channel it does have.
			assertQuaternionClose(
				assert,
				stunt.spine.quaternion,
				expectedQuaternion( SPINE_FROM, SPINE_TO, 0.7 ),
				'Stunt Spine keeps animating without an Arm bone'
			);
			assert.numEqual(
				stunt.face.morphTargetInfluences[ stunt.face.morphTargetDictionary.Smile ],
				expectedInfluence( SMILE_FROM, SMILE_TO, 0.7 ),
				'Stunt Smile weight keeps animating without an Arm bone'
			);
			assert.numEqual(
				stunt.face.morphTargetInfluences[ stunt.face.morphTargetDictionary.Frown ],
				expectedInfluence( FROWN_FROM, FROWN_TO, 0.7 ),
				'Stunt Frown weight keeps animating without an Arm bone'
			);
			assert.strictEqual( stunt.sword.rotation.y, 1.23, 'Stunt Sword prop is untouched' );

			// The original model, which has every channel, is fully unaffected.
			assertQuaternionClose(
				assert,
				original.spine.quaternion,
				expectedQuaternion( SPINE_FROM, SPINE_TO, 0.5 ),
				'Original Spine keeps animating'
			);
			assertQuaternionClose(
				assert,
				original.arm.quaternion,
				expectedQuaternion( ARM_FROM, ARM_TO, 0.5 ),
				'Original Arm keeps animating'
			);

		} );

		QUnit.test( 'released bindings rebind to a replaced skeleton and expression layout', ( assert ) => {

			const original = createCharacter( { expressionOrder: [ 'Smile', 'Frown', 'Idle' ] } );
			const stunt = createCharacter();

			const clip = createPerformanceClip();

			const mixer = new AnimationMixer( original.root );
			const stuntMixer = new AnimationMixer( stunt.root );

			const action = mixer.clipAction( clip );
			const stuntAction = stuntMixer.clipAction( clip );

			action.play();
			stuntAction.play();

			mixer.update( 0.25 );
			stuntMixer.update( 0.1 );

			// Snapshot the pose the detached Arm must retain after the rebind.
			const detachedArm = original.arm;
			const frozenArmQuaternion = detachedArm.quaternion.clone();
			const frozenSpineQuaternion = original.spine.quaternion.clone();

			// The editor releases every animation binding of the original model.
			const releasedBindings = action._propertyBindings;
			for ( let i = 0; i < releasedBindings.length; i ++ ) {

				releasedBindings[ i ].binding.unbind();

			}

			// Costume change: the old skeleton (including the detached Arm) is
			// removed from the hierarchy, and a new skeleton without the Arm bone
			// takes its place. The face mesh gets its expressions laid out in the
			// opposite order.
			const newSpine = new Bone();
			newSpine.name = 'Spine';
			original.root.remove( original.spine );
			original.root.add( newSpine );
			original.root.bind( new Skeleton( [ newSpine ] ) );

			const oldFace = original.face;
			const newFace = new Mesh( createFaceGeometry( [ 'Frown', 'Smile', 'Idle' ] ) );
			newFace.name = 'Face';
			newFace.morphTargetInfluences[ newFace.morphTargetDictionary.Idle ] = 0.42;
			original.root.remove( oldFace );
			original.root.add( newFace );
			original.face = newFace;

			// Replay on the same clip; the bindings lazily resolve their new targets.
			// The removed Arm channel has no target anymore and only warns.
			action.reset();
			action.play();

			console.level = CONSOLE_LEVEL.OFF;

			try {

				mixer.update( 0.5 );

			} finally {

				console.level = CONSOLE_LEVEL.DEFAULT;

			}

			// The remaining bone is driven on the new skeleton, not the old one.
			assert.ok( newSpine !== original.spine, 'The character now uses a replacement Spine bone' );
			assertQuaternionClose(
				assert,
				newSpine.quaternion,
				expectedQuaternion( SPINE_FROM, SPINE_TO, 0.5 ),
				'Replay drives the replacement Spine from the same clip'
			);
			assertQuaternionClose(
				assert,
				original.spine.quaternion,
				frozenSpineQuaternion,
				'The old Spine keeps the pose it had when unbound'
			);
			assertQuaternionClose(
				assert,
				detachedArm.quaternion,
				frozenArmQuaternion,
				'The removed Arm keeps the pose it had when unbound'
			);

			// Named expressions resolve against the replacement mesh's new layout.
			assert.numEqual(
				newFace.morphTargetInfluences[ newFace.morphTargetDictionary.Smile ],
				expectedInfluence( SMILE_FROM, SMILE_TO, 0.5 ),
				'Smile drives the correct slot after the expression order changed'
			);
			assert.numEqual(
				newFace.morphTargetInfluences[ newFace.morphTargetDictionary.Frown ],
				expectedInfluence( FROWN_FROM, FROWN_TO, 0.5 ),
				'Frown drives the correct slot after the expression order changed'
			);
			assert.strictEqual(
				newFace.morphTargetInfluences[ newFace.morphTargetDictionary.Idle ],
				0.42,
				'Idle expression without a track keeps its value after the rebind'
			);
			assert.strictEqual( original.sword.rotation.y, 1.23, 'The same-named Sword prop is untouched' );

			// The other character keeps playing independently throughout the swap.
			stuntMixer.update( 0.3 );
			assertQuaternionClose(
				assert,
				stunt.spine.quaternion,
				expectedQuaternion( SPINE_FROM, SPINE_TO, 0.4 ),
				'Stunt Spine keeps its own independent playback during the costume change'
			);
			assertQuaternionClose(
				assert,
				stunt.arm.quaternion,
				expectedQuaternion( ARM_FROM, ARM_TO, 0.4 ),
				'Stunt Arm keeps its own independent playback during the costume change'
			);
			assert.notStrictEqual( stunt.root.uuid, original.root.uuid, 'The two characters remain separate roots' );

		} );

	} );

} );
