import { AnimationMixer } from '../../../../src/animation/AnimationMixer.js';
import { AnimationClip } from '../../../../src/animation/AnimationClip.js';
import { QuaternionKeyframeTrack } from '../../../../src/animation/tracks/QuaternionKeyframeTrack.js';
import { Object3D } from '../../../../src/core/Object3D.js';
import { Quaternion } from '../../../../src/math/Quaternion.js';
import { Vector3 } from '../../../../src/math/Vector3.js';
import { AdditiveAnimationBlendMode } from '../../../../src/constants.js';

const EPS = 1e-7;

// Local axes of the upper arm whose world-space orientation is verified.
const PALM_FACING = new Vector3( 0, 0, 1 );
const THUMB_DIRECTION = new Vector3( 1, 0, 0 );

// Fixed poses used by the test clips: an angled rest pose, two ordinary
// actions and an additive aiming deflection, all rotations far enough apart
// to keep the slerp math on its generic branch.
const REST_QUATERNION = new Quaternion().setFromAxisAngle( new Vector3( 1, 0, 0 ), 0.4 );
const POSE_A = new Quaternion().setFromAxisAngle( new Vector3( 0, 1, 0 ), 1.1 );
const POSE_B = new Quaternion().setFromAxisAngle( new Vector3( 0, 0, 1 ), - 0.8 );
const AIM_POSE = new Quaternion().setFromAxisAngle( new Vector3( 1, 1, 0 ).normalize(), 0.55 );

function createRig( restQuaternion ) {

	// The character root carries a base turn so that a correct world-space
	// expectation has to take the parent rotation into account.
	const root = new Object3D();
	root.quaternion.setFromAxisAngle( new Vector3( 0, 1, 0 ), 0.7 );

	const upperArm = new Object3D();
	upperArm.quaternion.copy( restQuaternion );
	root.add( upperArm );

	return { root, upperArm };

}

function createQuaternionClip( name, quaternion, additive = false ) {

	const track = new QuaternionKeyframeTrack(
		'.quaternion',
		[ 0, 1 ],
		[ ...quaternion.toArray(), ...quaternion.toArray() ]
	);

	return new AnimationClip(
		name,
		1,
		[ track ],
		additive ? AdditiveAnimationBlendMode : undefined
	);

}

// The same rotation can be authored with either sign of its quaternion;
// this builds the equivalent (double-cover) representation of a clip.
function createNegatedClip( clip ) {

	const sourceTrack = clip.tracks[ 0 ];
	const values = Array.from( sourceTrack.values, value => - value );
	const track = new QuaternionKeyframeTrack( sourceTrack.name, Array.from( sourceTrack.times ), values );

	return new AnimationClip( clip.name + 'Negated', clip.duration, [ track ], clip.blendMode );

}

function setupMixer( restQuaternion ) {

	const { root, upperArm } = createRig( restQuaternion );

	// The clips drive the upper arm directly while the root's base turn
	// remains a pure parent rotation.
	const mixer = new AnimationMixer( upperArm );

	return { root, upperArm, mixer };

}

function playAll( mixer, clips, weights ) {

	const actions = clips.map( ( clip, i ) =>
		mixer.clipAction( clip ).setEffectiveWeight( weights[ i ] ).play()
	);

	mixer.update( 0.5 );

	return actions;

}

// Independent re-implementation of the PropertyMixer quaternion math.
// Normal layers are slerped in accumulation order, with the rest pose
// filling the missing weight when the cumulative weight stays below 1;
// additive layers are post-multiplied and slerped in by their own weight.
function blendLocalQuaternion( restQuaternion, normalLayers, additiveLayers ) {

	const result = new Quaternion();
	let cumulativeWeight = 0;

	for ( const layer of normalLayers ) {

		if ( cumulativeWeight === 0 ) {

			result.copy( layer.quaternion );

		} else {

			cumulativeWeight += layer.weight;
			result.slerp( layer.quaternion, layer.weight / cumulativeWeight );
			continue;

		}

		cumulativeWeight = layer.weight;

	}

	if ( cumulativeWeight === 0 ) {

		result.copy( restQuaternion );

	} else if ( cumulativeWeight < 1 ) {

		result.slerp( restQuaternion, 1 - cumulativeWeight );

	}

	const work = new Quaternion();

	for ( const layer of additiveLayers ) {

		work.multiplyQuaternions( result, layer.quaternion );
		result.slerp( work, layer.weight );

	}

	return result;

}

function toLayers( quaternions, weights ) {

	return quaternions.map( ( quaternion, i ) => ( {
		quaternion,
		weight: weights[ i ]
	} ) ).filter( layer => layer.weight > 0 );

}

function assertWorldOrientation( assert, root, upperArm, expectedLocalQuaternion, label ) {

	upperArm.updateWorldMatrix( true, false );

	const expectedWorldQuaternion = new Quaternion()
		.multiplyQuaternions( root.quaternion, expectedLocalQuaternion );
	const actualWorldQuaternion = upperArm.getWorldQuaternion( new Quaternion() );

	const palmDifference = new Vector3().copy( PALM_FACING ).applyQuaternion( actualWorldQuaternion )
		.distanceTo( new Vector3().copy( PALM_FACING ).applyQuaternion( expectedWorldQuaternion ) );
	const thumbDifference = new Vector3().copy( THUMB_DIRECTION ).applyQuaternion( actualWorldQuaternion )
		.distanceTo( new Vector3().copy( THUMB_DIRECTION ).applyQuaternion( expectedWorldQuaternion ) );

	assert.ok(
		palmDifference < EPS,
		label + ': palm facing matches the independently computed world direction'
	);
	assert.ok(
		thumbDifference < EPS,
		label + ': thumb direction matches the independently computed world direction'
	);
	assert.ok(
		Math.abs( upperArm.quaternion.dot( expectedLocalQuaternion ) ) > 1 - EPS,
		label + ': local upper arm quaternion matches the blended quaternion (up to sign)'
	);

}

function assertSameWorldDirections( assert, upperArmA, upperArmB, label ) {

	upperArmA.updateWorldMatrix( true, false );
	upperArmB.updateWorldMatrix( true, false );

	const quaternionA = upperArmA.getWorldQuaternion( new Quaternion() );
	const quaternionB = upperArmB.getWorldQuaternion( new Quaternion() );

	const palmDifference = new Vector3().copy( PALM_FACING ).applyQuaternion( quaternionA )
		.distanceTo( new Vector3().copy( PALM_FACING ).applyQuaternion( quaternionB ) );
	const thumbDifference = new Vector3().copy( THUMB_DIRECTION ).applyQuaternion( quaternionA )
		.distanceTo( new Vector3().copy( THUMB_DIRECTION ).applyQuaternion( quaternionB ) );

	assert.ok( palmDifference < EPS, label + ': palm facing is identical' );
	assert.ok( thumbDifference < EPS, label + ': thumb direction is identical' );

}

export default QUnit.module( 'Animation', () => {

	QUnit.module( 'PropertyMixer', () => {

		const clipA = createQuaternionClip( 'normalActionA', POSE_A );
		const clipB = createQuaternionClip( 'normalActionB', POSE_B );
		const clipAim = createQuaternionClip( 'additiveAim', AIM_POSE, true );

		const negatedClipA = createNegatedClip( clipA );
		const negatedClipB = createNegatedClip( clipB );
		const negatedClipAim = createNegatedClip( clipAim );

		// PUBLIC

		QUnit.test( 'blends normal and additive quaternion layers into independently computable orientations', ( assert ) => {

			const scenarios = [
				{
					label: 'normal layers below full weight',
					weights: [ 0.3, 0.4 ],
					additiveWeight: 0.6
				},
				{
					label: 'normal layers beyond full weight',
					weights: [ 0.8, 0.7 ],
					additiveWeight: 0.5
				},
				{
					label: 'single normal layer beyond full weight',
					weights: [ 1.2, 0 ],
					additiveWeight: 1
				},
				{
					label: 'one normal layer has zero weight',
					weights: [ 0, 0.5 ],
					additiveWeight: 0.9
				},
				{
					label: 'additive layer has zero weight',
					weights: [ 0.6, 0.2 ],
					additiveWeight: 0
				}
			];

			for ( const scenario of scenarios ) {

				const weights = [ ...scenario.weights, scenario.additiveWeight ];
				const setup = setupMixer( REST_QUATERNION );
				const actions = playAll( setup.mixer, [ clipA, clipB, clipAim ], weights );

				const expectedLocal = blendLocalQuaternion(
					REST_QUATERNION,
					toLayers( [ POSE_A, POSE_B ], scenario.weights ),
					toLayers( [ AIM_POSE ], [ scenario.additiveWeight ] )
				);

				assertWorldOrientation(
					assert, setup.root, setup.upperArm, expectedLocal, scenario.label
				);

				// The animator retunes the weights while playback is running;
				// the next frame must blend at the new cumulative weights.
				const adjustedWeights = weights.map( weight => weight * 0.5 );
				actions.forEach( ( action, i ) => action.setEffectiveWeight( adjustedWeights[ i ] ) );
				setup.mixer.update( 0.3 );

				const adjustedExpectedLocal = blendLocalQuaternion(
					REST_QUATERNION,
					toLayers( [ POSE_A, POSE_B ], scenario.weights.map( weight => weight * 0.5 ) ),
					toLayers( [ AIM_POSE ], [ scenario.additiveWeight * 0.5 ] )
				);

				assertWorldOrientation(
					assert,
					setup.root,
					setup.upperArm,
					adjustedExpectedLocal,
					scenario.label + ' after retuning weights during playback'
				);

				// Re-authoring the same clips with the negated quaternions
				// (the double cover of SO(3)) must leave both directions unchanged.
				const doubleCoverSetup = setupMixer( REST_QUATERNION );
				playAll(
					doubleCoverSetup.mixer,
					[ negatedClipA, negatedClipB, negatedClipAim ],
					weights
				);

				const referenceSetup = setupMixer( REST_QUATERNION );
				playAll( referenceSetup.mixer, [ clipA, clipB, clipAim ], weights );

				assertSameWorldDirections(
					assert,
					referenceSetup.upperArm,
					doubleCoverSetup.upperArm,
					scenario.label + ' with equivalent negated quaternions'
				);

			}

		} );

		QUnit.test( 'keeps the remaining layers correct while layers are taken down and restores the rest pose', ( assert ) => {

			const { root, upperArm, mixer } = setupMixer( REST_QUATERNION );

			const actionA = mixer.clipAction( clipA ).setEffectiveWeight( 0.5 ).play();
			const actionB = mixer.clipAction( clipB ).setEffectiveWeight( 0.35 ).play();
			const actionAim = mixer.clipAction( clipAim ).setEffectiveWeight( 0.6 ).play();

			let normalLayers = [
				{ quaternion: POSE_A, weight: 0.5 },
				{ quaternion: POSE_B, weight: 0.35 }
			];
			let additiveLayers = [ { quaternion: AIM_POSE, weight: 0.6 } ];

			mixer.update( 0.2 );
			assertWorldOrientation(
				assert,
				root,
				upperArm,
				blendLocalQuaternion( REST_QUATERNION, normalLayers, additiveLayers ),
				'with all layers active'
			);

			// Take down the second ordinary action.
			actionB.stop();
			mixer.update( 0.2 );
			normalLayers = [ normalLayers[ 0 ] ];
			assertWorldOrientation(
				assert,
				root,
				upperArm,
				blendLocalQuaternion( REST_QUATERNION, normalLayers, additiveLayers ),
				'after taking down the second ordinary action'
			);

			// Take down the additive aiming layer.
			actionAim.stop();
			mixer.update( 0.2 );
			additiveLayers = [];
			assertWorldOrientation(
				assert,
				root,
				upperArm,
				blendLocalQuaternion( REST_QUATERNION, normalLayers, additiveLayers ),
				'after taking down the additive aiming layer'
			);

			// Taking down the last action restores the saved rest pose.
			actionA.stop();
			mixer.update( 0.2 );
			assert.ok(
				upperArm.quaternion.angleTo( REST_QUATERNION ) < EPS,
				'full teardown restores the saved rest pose'
			);

		} );

		QUnit.test( 'uses a manually adjusted rest pose for blending and for the final restore after restart', ( assert ) => {

			const { root, upperArm, mixer } = setupMixer( REST_QUATERNION );

			// Play once and fully tear down, so the mixer has no active layer.
			const action = mixer.clipAction( clipA ).setEffectiveWeight( 0.5 ).play();
			mixer.update( 0.2 );
			action.stop();
			mixer.update( 0.2 );
			assert.ok(
				upperArm.quaternion.angleTo( REST_QUATERNION ) < EPS,
				'teardown restores the original rest pose before the manual adjustment'
			);

			// The animator manually re-poses the upper arm while nothing is playing.
			const adjustedRestQuaternion = new Quaternion()
				.setFromAxisAngle( new Vector3( 0, 0, 1 ), 1.3 );
			upperArm.quaternion.copy( adjustedRestQuaternion );

			// Restart playback; the adjusted pose is the new original state.
			const actionA = mixer.clipAction( clipA ).setEffectiveWeight( 0.5 ).play();
			const actionB = mixer.clipAction( clipB ).setEffectiveWeight( 0.35 ).play();
			const actionAim = mixer.clipAction( clipAim ).setEffectiveWeight( 0.6 ).play();
			mixer.update( 0.2 );

			const expectedLocal = blendLocalQuaternion(
				adjustedRestQuaternion,
				[
					{ quaternion: POSE_A, weight: 0.5 },
					{ quaternion: POSE_B, weight: 0.35 }
				],
				[ { quaternion: AIM_POSE, weight: 0.6 } ]
			);

			assertWorldOrientation(
				assert,
				root,
				upperArm,
				expectedLocal,
				'blending after restart is based on the adjusted rest pose'
			);

			// The final teardown must restore the adjusted pose, not the old one.
			actionA.stop();
			actionB.stop();
			actionAim.stop();
			mixer.update( 0.2 );

			assert.ok(
				upperArm.quaternion.angleTo( adjustedRestQuaternion ) < EPS,
				'the final teardown restores the adjusted rest pose'
			);

		} );

	} );

} );
