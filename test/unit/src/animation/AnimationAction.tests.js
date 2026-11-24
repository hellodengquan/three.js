import { AnimationAction } from '../../../../src/animation/AnimationAction.js';

import { AnimationMixer } from '../../../../src/animation/AnimationMixer.js';
import { AnimationClip } from '../../../../src/animation/AnimationClip.js';
import { NumberKeyframeTrack } from '../../../../src/animation/tracks/NumberKeyframeTrack.js';
import { Object3D } from '../../../../src/core/Object3D.js';
import { LoopOnce, LoopRepeat, LoopPingPong } from '../../../../src/constants.js';

function createAnimation() {

	const root = new Object3D();
	const mixer = new AnimationMixer( root );
	const track = new NumberKeyframeTrack( '.rotation[x]', [ 0, 1000 ], [ 0, 360 ] );
	const clip = new AnimationClip( 'clip1', 1000, [ track ] );

	const animationAction = mixer.clipAction( clip );
	return {
		root: root,
		mixer: mixer,
		track: track,
		clip: clip,
		animationAction: animationAction
	};

}

function createTwoAnimations() {

	const root = new Object3D();
	const mixer = new AnimationMixer( root );
	const track = new NumberKeyframeTrack( '.rotation[x]', [ 0, 1000 ], [ 0, 360 ] );
	const clip = new AnimationClip( 'clip1', 1000, [ track ] );
	const animationAction = mixer.clipAction( clip );

	const track2 = new NumberKeyframeTrack( '.rotation[y]', [ 0, 1000 ], [ 0, 360 ] );
	const clip2 = new AnimationClip( 'clip2', 1000, [ track ] );
	const animationAction2 = mixer.clipAction( clip2 );

	return {
		root: root,
		mixer: mixer,
		track: track,
		clip: clip,
		animationAction: animationAction,
		track2: track2,
		clip2: clip2,
		animationAction2: animationAction2
	};

}

// Builds a ping-pong rig whose root starts away from the track's first key,
// so a released (disabled) action can be told apart from a clamped (paused) one:
// the binding then blends back to the root's original rotation (11), whereas the
// track itself only ever produces values in [0, 360].
function createPingPongRig( options = {} ) {

	const { repetitions = Infinity, clampWhenFinished = false } = options;

	const root = new Object3D();
	root.rotation.x = 11;

	const mixer = new AnimationMixer( root );
	const track = new NumberKeyframeTrack( '.rotation[x]', [ 0, 1000 ], [ 0, 360 ] );
	const clip = new AnimationClip( 'pingpong', 1000, [ track ] );

	const animationAction = mixer.clipAction( clip );
	animationAction.setLoop( LoopPingPong, repetitions );
	animationAction.clampWhenFinished = clampWhenFinished;
	animationAction.play();

	// One entry per loop/finished event; loopDelta is signed so rewinding shows
	// up as negative directed endpoint crossings.
	const events = [];
	mixer.addEventListener( 'loop', ( event ) => events.push( { type: 'loop', loopDelta: event.loopDelta } ) );
	mixer.addEventListener( 'finished', ( event ) => events.push( { type: 'finished', direction: event.direction } ) );

	return { root, mixer, animationAction, events };

}

// A schedule step is [ deltaTime, optional mixer timeScale ]. Each step is one
// update call, i.e. one rendered frame; a single large delta is a dropped frame
// that may cross several rounds at once. Returns one snapshot per frame.
function runSchedule( rig, steps ) {

	const frames = [];

	for ( const step of steps ) {

		const [ deltaTime, timeScale ] = step;

		if ( timeScale !== undefined ) rig.mixer.timeScale = timeScale;

		const eventsBefore = rig.events.length;
		rig.mixer.update( deltaTime );

		frames.push( {
			mixerTime: rig.mixer.time,
			position: rig.root.rotation.x,
			actionTime: rig.animationAction.time,
			loopCount: rig.animationAction._loopCount,
			events: rig.events.slice( eventsBefore )
		} );

	}

	return frames;

}

// Runs a playback split into directed segments (e.g. forward / rewind / forward).
// The last frame of every segment is recorded as a milestone: all subdivisions of
// the same directed timeline pass through the same milestone states, even though
// the mixer's global time is revisited during a ping-pong and so cannot identify
// a clock state on its own.
function runSegmentedSchedule( rig, segments ) {

	const frames = [];
	const milestones = [];

	for ( const segment of segments ) {

		frames.push( ...runSchedule( rig, segment ) );
		milestones.push( frames[ frames.length - 1 ] );

	}

	return { frames, milestones };

}

// Asserts that two subdivisions of the same playback reach identical milestone
// states: rendered position, local action time and consumed round-trip count.
function assertSameMilestones( assert, actual, expected, message ) {

	assert.equal( actual.milestones.length, expected.milestones.length,
		`${ message }: both subdivisions pass through the same number of milestones.` );

	for ( let i = 0; i !== expected.milestones.length; i ++ ) {

		const a = actual.milestones[ i ];
		const e = expected.milestones[ i ];

		assert.equal( a.position, e.position,
			`${ message }: milestone ${ i } rendered position matches (${ e.position }).` );
		assert.equal( a.actionTime, e.actionTime,
			`${ message }: milestone ${ i } local action time matches (${ e.actionTime }).` );
		assert.equal( a.loopCount, e.loopCount,
			`${ message }: milestone ${ i } consumed round-trip count matches (${ e.loopCount }).` );

	}

}

// Signed sum of the directed endpoint crossings reported by 'loop' events.
function signedLoopDistance( frames ) {

	let distance = 0;

	for ( const frame of frames )
		for ( const event of frame.events )
			if ( event.type === 'loop' ) distance += event.loopDelta;

	return distance;

}

function countEvents( frames, type ) {

	let count = 0;

	for ( const frame of frames )
		for ( const event of frame.events )
			if ( event.type === type ) count ++;

	return count;

}

function findFrame( frames, predicate ) {

	return frames.find( predicate );

}

function findFrameIndex( frames, predicate ) {

	return frames.findIndex( predicate );

}

export default QUnit.module( 'Animation', () => {

	QUnit.module( 'AnimationAction', () => {

		// INSTANCING
		QUnit.test( 'Instancing', ( assert ) => {

			const mixer = new AnimationMixer();
			const clip = new AnimationClip( 'nonname', - 1, [] );

			const animationAction = new AnimationAction( mixer, clip );
			assert.ok( animationAction, 'animationAction instantiated' );

		} );

		// PUBLIC STUFF
		QUnit.test( 'play', ( assert ) => {

			const { mixer, animationAction } = createAnimation();
			const animationAction2 = animationAction.play();
			assert.equal( animationAction, animationAction2, 'AnimationAction.play can be chained.' );

			const UserException = function () {

				this.message = 'AnimationMixer must activate AnimationAction on play.';

			};

			mixer._activateAction = function ( action ) {

				if ( action === animationAction ) {

					throw new UserException();

				}

			};

			assert.throws( () => {

				animationAction.play();

			}, new UserException() );

		} );

		QUnit.test( 'stop', ( assert ) => {

			const { mixer, animationAction } = createAnimation();
			const animationAction2 = animationAction.stop();
			assert.equal( animationAction, animationAction2, 'AnimationAction.stop can be chained.' );

			const UserException = function () {

				this.message = 'AnimationMixer must deactivate AnimationAction on stop.';

			};

			mixer._deactivateAction = function ( action ) {

				if ( action === animationAction ) {

					throw new UserException();

				}

			};

			assert.throws( () => {

				animationAction.stop();

			}, new UserException() );

		} );

		QUnit.test( 'reset', ( assert ) => {

			const { animationAction } = createAnimation();
			const animationAction2 = animationAction.stop();
			assert.equal( animationAction, animationAction2, 'AnimationAction.reset can be chained.' );
			assert.equal( animationAction2.paused, false, 'AnimationAction.reset() sets paused false' );
			assert.equal( animationAction2.enabled, true, 'AnimationAction.reset() sets enabled true' );
			assert.equal( animationAction2.time, 0, 'AnimationAction.reset() resets time.' );
			assert.equal( animationAction2._loopCount, - 1, 'AnimationAction.reset() resets loopcount.' );
			assert.equal( animationAction2._startTime, null, 'AnimationAction.reset() removes starttime.' );

		} );

		QUnit.test( 'isRunning', ( assert ) => {

			const { animationAction } = createAnimation();
			assert.notOk( animationAction.isRunning(), 'When an animation is just made, it is not running.' );
			animationAction.play();
			assert.ok( animationAction.isRunning(), 'When an animation is started, it is running.' );
			animationAction.stop();
			assert.notOk( animationAction.isRunning(), 'When an animation is stopped, it is not running.' );
			animationAction.play();
			animationAction.paused = true;
			assert.notOk( animationAction.isRunning(), 'When an animation is paused, it is not running.' );
			animationAction.paused = false;
			animationAction.enabled = false;
			assert.notOk( animationAction.isRunning(), 'When an animation is not enabled, it is not running.' );
			animationAction.enabled = true;
			assert.ok( animationAction.isRunning(), 'When an animation is enabled, it is running.' );

		} );

		QUnit.test( 'isScheduled', ( assert ) => {

			const { mixer, animationAction } = createAnimation();
			assert.notOk( animationAction.isScheduled(), 'When an animation is just made, it is not scheduled.' );
			animationAction.play();
			assert.ok( animationAction.isScheduled(), 'When an animation is started, it is scheduled.' );
			mixer.update( 1 );
			assert.ok( animationAction.isScheduled(), 'When an animation is updated, it is scheduled.' );
			animationAction.stop();
			assert.notOk( animationAction.isScheduled(), 'When an animation is stopped, it isn\'t scheduled anymore.' );

		} );

		QUnit.test( 'startAt', ( assert ) => {

			const { mixer, animationAction } = createAnimation();
			animationAction.startAt( 2 );
			animationAction.play();
			assert.notOk( animationAction.isRunning(), 'When an animation is started at a specific time, it is not running.' );
			assert.ok( animationAction.isScheduled(), 'When an animation is started at a specific time, it is scheduled.' );
			mixer.update( 1 );
			assert.notOk( animationAction.isRunning(), 'When an animation is started at a specific time and the interval is not passed, it is not running.' );
			assert.ok( animationAction.isScheduled(), 'When an animation is started at a specific time and the interval is not passed, it is scheduled.' );
			mixer.update( 1 );
			assert.ok( animationAction.isRunning(), 'When an animation is started at a specific time and the interval is passed, it is running.' );
			assert.ok( animationAction.isScheduled(), 'When an animation is started at a specific time and the interval is passed, it is scheduled.' );
			animationAction.stop();
			assert.notOk( animationAction.isRunning(), 'When an animation is stopped, it is not running.' );
			assert.notOk( animationAction.isScheduled(), 'When an animation is stopped, it is not scheduled.' );

		} );

		QUnit.test( 'setLoop LoopOnce', ( assert ) => {

			const { mixer, animationAction } = createAnimation();
			animationAction.setLoop( LoopOnce );
			animationAction.play();
			assert.ok( animationAction.isRunning(), 'When an animation is started, it is running.' );
			mixer.update( 500 );
			assert.ok( animationAction.isRunning(), 'When an animation is in the first loop, it is running.' );
			mixer.update( 500 );
			assert.notOk( animationAction.isRunning(), 'When an animation is ended, it is not running.' );
			mixer.update( 500 );
			assert.notOk( animationAction.isRunning(), 'When an animation is ended, it is not running.' );

		} );

		QUnit.test( 'setLoop LoopRepeat', ( assert ) => {

			const { root, mixer, animationAction } = createAnimation();
			animationAction.setLoop( LoopRepeat, 3 );
			animationAction.play();
			assert.ok( animationAction.isRunning(), 'When an animation is started, it is running.' );
			mixer.update( 750 );
			assert.equal( root.rotation.x, 270, 'When an animation is 3/4 in the first loop, it has changed to 3/4 when LoopRepeat.' );
			assert.ok( animationAction.isRunning(), 'When an animation is in the first loop, it is running.' );
			mixer.update( 1000 );
			assert.equal( root.rotation.x, 270, 'When an animation is 3/4 in the second loop, it has changed to 3/4 when LoopRepeat.' );
			assert.ok( animationAction.isRunning(), 'When an animation is in second loop when in looprepeat 3 times, it is running.' );
			mixer.update( 1000 );
			assert.equal( root.rotation.x, 270, 'When an animation is 3/4 in the third loop, it has changed to 3/4 when LoopRepeat.' );
			assert.ok( animationAction.isRunning(), 'When an animation is in third loop when in looprepeat 3 times, it is running.' );
			mixer.update( 1000 );
			assert.equal( root.rotation.x, 0, 'When an animation ended his third loop when in looprepeat 3 times, it stays on the end result.' );
			assert.notOk( animationAction.isRunning(), 'When an animation ended his third loop when in looprepeat 3 times, it stays not running anymore.' );

		} );

		QUnit.test( 'setLoop LoopPingPong', ( assert ) => {

			const { root, mixer, animationAction } = createAnimation();
			animationAction.setLoop( LoopPingPong, 3 );
			animationAction.play();
			assert.ok( animationAction.isRunning(), 'When an animation is started, it is running.' );
			mixer.update( 750 );
			assert.equal( root.rotation.x, 270, 'When an animation is 3/4 in the first loop, it has changed to 3/4 when LoopPingPong.' );
			assert.ok( animationAction.isRunning(), 'When an animation is in the first loop, it is running.' );
			mixer.update( 1000 );
			assert.equal( root.rotation.x, 90, 'When an animation is 3/4 in the second loop, it has changed to 1/4 when LoopPingPong.' );
			assert.ok( animationAction.isRunning(), 'When an animation is in second loop when in looprepeat 3 times, it is running.' );
			mixer.update( 1000 );
			assert.equal( root.rotation.x, 270, 'When an animation is 3/4 in the third loop, it has changed to 3/4 when LoopPingPong.' );
			assert.ok( animationAction.isRunning(), 'When an animation is in third loop when in looprepeat 3 times, it is running.' );
			mixer.update( 1000 );
			assert.equal( root.rotation.x, 0, 'When an animation ended his fourth loop when in looprepeat 3 times, it stays on the end result.' );
			assert.notOk( animationAction.isRunning(), 'When an animation ended his fourth loop when in looprepeat 3 times, it stays not running anymore.' );

		} );

		QUnit.test( 'setEffectiveWeight', ( assert ) => {

			const { animationAction } = createAnimation();
			assert.equal( animationAction.getEffectiveWeight(), 1, 'When an animation is created, EffectiveWeight is 1.' );
			animationAction.setEffectiveWeight( 0.3 );
			assert.equal( animationAction.getEffectiveWeight(), 0.3, 'When EffectiveWeight is set to 0.3 , EffectiveWeight is 0.3.' );

		} );

		QUnit.test( 'setEffectiveWeight - disabled', ( assert ) => {

			const { animationAction } = createAnimation();
			assert.equal( animationAction.getEffectiveWeight(), 1, 'When an animation is created, EffectiveWeight is 1.' );
			animationAction.enabled = false;
			animationAction.setEffectiveWeight( 0.3 );
			assert.equal( animationAction.getEffectiveWeight(), 0, 'When EffectiveWeight is set to 0.3 when disabled , EffectiveWeight is 0.' );

		} );

		QUnit.test( 'setEffectiveWeight - over duration', ( assert ) => {

			const { root, mixer, animationAction } = createAnimation();
			animationAction.setEffectiveWeight( 0.5 );
			animationAction.play();
			mixer.update( 500 );
			assert.equal( root.rotation.x, 90, 'When an animation has weight 0.5 and runs half through the animation, it has changed to 1/4.' );
			mixer.update( 1000 );
			assert.equal( root.rotation.x, 90, 'When an animation has weight 0.5 and runs one and half through the animation, it has changed to 1/4.' );

		} );

		QUnit.test( 'getEffectiveWeight', ( assert ) => {

			let { animationAction } = createAnimation();
			assert.equal( animationAction.getEffectiveWeight(), 1, 'When an animation is created, EffectiveWeight is 1.' );
			animationAction.setEffectiveWeight( 0.3 );
			assert.equal( animationAction.getEffectiveWeight(), 0.3, 'When EffectiveWeight is set to 0.3 , EffectiveWeight is 0.3.' );

			( { animationAction } = createAnimation() );
			assert.equal( animationAction.getEffectiveWeight(), 1, 'When an animation is created, EffectiveWeight is 1.' );
			animationAction.enabled = false;
			animationAction.setEffectiveWeight( 0.3 );
			assert.equal( animationAction.getEffectiveWeight(), 0, 'When EffectiveWeight is set to 0.3 when disabled , EffectiveWeight is 0.' );

		} );

		QUnit.test( 'fadeIn', ( assert ) => {

			const { mixer, animationAction } = createAnimation();
			animationAction.fadeIn( 1000 );
			animationAction.play();
			assert.equal( animationAction.getEffectiveWeight(), 1, 'When an animation fadeIn is started, EffectiveWeight is 1.' );
			mixer.update( 250 );
			assert.equal( animationAction.getEffectiveWeight(), 0.25, 'When an animation fadeIn happened 1/4, EffectiveWeight is 0.25.' );
			mixer.update( 250 );
			assert.equal( animationAction.getEffectiveWeight(), 0.5, 'When an animation fadeIn is halfway , EffectiveWeight is 0.5.' );
			mixer.update( 250 );
			assert.equal( animationAction.getEffectiveWeight(), 0.75, 'When an animation fadeIn is halfway , EffectiveWeight is 0.75.' );
			mixer.update( 500 );
			assert.equal( animationAction.getEffectiveWeight(), 1, 'When an animation fadeIn is ended , EffectiveWeight is 1.' );

		} );

		QUnit.test( 'fadeOut', ( assert ) => {

			const { mixer, animationAction } = createAnimation();
			animationAction.fadeOut( 1000 );
			animationAction.play();
			assert.equal( animationAction.getEffectiveWeight(), 1, 'When an animation fadeOut is started, EffectiveWeight is 1.' );
			mixer.update( 250 );
			assert.equal( animationAction.getEffectiveWeight(), 0.75, 'When an animation fadeOut happened 1/4, EffectiveWeight is 0.75.' );
			mixer.update( 250 );
			assert.equal( animationAction.getEffectiveWeight(), 0.5, 'When an animation fadeOut is halfway , EffectiveWeight is 0.5.' );
			mixer.update( 250 );
			assert.equal( animationAction.getEffectiveWeight(), 0.25, 'When an animation fadeOut is happened 3/4 , EffectiveWeight is 0.25.' );
			mixer.update( 500 );
			assert.equal( animationAction.getEffectiveWeight(), 0, 'When an animation fadeOut is ended , EffectiveWeight is 0.' );

		} );

		QUnit.test( 'crossFadeFrom', ( assert ) => {

			const { mixer, animationAction, animationAction2 } = createTwoAnimations();
			animationAction.crossFadeFrom( animationAction2, 1000, false );
			animationAction.play();
			animationAction2.play();
			assert.equal( animationAction.getEffectiveWeight(), 1, 'When an animation crossFadeFrom is started, EffectiveWeight is 1.' );
			assert.equal( animationAction2.getEffectiveWeight(), 1, 'When an animation crossFadeFrom is started, EffectiveWeight is 1.' );
			mixer.update( 250 );
			assert.equal( animationAction.getEffectiveWeight(), 0.25, 'When an animation fadeOut happened 1/4, EffectiveWeight is 0.75.' );
			assert.equal( animationAction2.getEffectiveWeight(), 0.75, 'When an animation fadeOut happened 1/4, EffectiveWeight is 0.75.' );
			mixer.update( 250 );
			assert.equal( animationAction.getEffectiveWeight(), 0.5, 'When an animation fadeOut happened 1/4, EffectiveWeight is 0.75.' );
			assert.equal( animationAction2.getEffectiveWeight(), 0.5, 'When an animation fadeOut is halfway , EffectiveWeight is 0.5.' );
			mixer.update( 250 );
			assert.equal( animationAction.getEffectiveWeight(), 0.75, 'When an animation fadeOut happened 1/4, EffectiveWeight is 0.75.' );
			assert.equal( animationAction2.getEffectiveWeight(), 0.25, 'When an animation fadeOut is happened 3/4 , EffectiveWeight is 0.25.' );
			mixer.update( 500 );
			assert.equal( animationAction.getEffectiveWeight(), 1, 'When an animation fadeOut happened 1/4, EffectiveWeight is 0.75.' );
			assert.equal( animationAction2.getEffectiveWeight(), 0, 'When an animation fadeOut is ended , EffectiveWeight is 0.' );

		} );

		QUnit.test( 'crossFadeTo', ( assert ) => {

			const { mixer, animationAction, animationAction2 } = createTwoAnimations();
			animationAction2.crossFadeTo( animationAction, 1000, false );
			animationAction.play();
			animationAction2.play();
			assert.equal( animationAction.getEffectiveWeight(), 1, 'When an animation crossFadeFrom is started, EffectiveWeight is 1.' );
			assert.equal( animationAction2.getEffectiveWeight(), 1, 'When an animation crossFadeFrom is started, EffectiveWeight is 1.' );
			mixer.update( 250 );
			assert.equal( animationAction.getEffectiveWeight(), 0.25, 'When an animation fadeOut happened 1/4, EffectiveWeight is 0.75.' );
			assert.equal( animationAction2.getEffectiveWeight(), 0.75, 'When an animation fadeOut happened 1/4, EffectiveWeight is 0.75.' );
			mixer.update( 250 );
			assert.equal( animationAction.getEffectiveWeight(), 0.5, 'When an animation fadeOut happened 1/4, EffectiveWeight is 0.75.' );
			assert.equal( animationAction2.getEffectiveWeight(), 0.5, 'When an animation fadeOut is halfway , EffectiveWeight is 0.5.' );
			mixer.update( 250 );
			assert.equal( animationAction.getEffectiveWeight(), 0.75, 'When an animation fadeOut happened 1/4, EffectiveWeight is 0.75.' );
			assert.equal( animationAction2.getEffectiveWeight(), 0.25, 'When an animation fadeOut is happened 3/4 , EffectiveWeight is 0.25.' );
			mixer.update( 500 );
			assert.equal( animationAction.getEffectiveWeight(), 1, 'When an animation fadeOut happened 1/4, EffectiveWeight is 0.75.' );
			assert.equal( animationAction2.getEffectiveWeight(), 0, 'When an animation fadeOut is ended , EffectiveWeight is 0.' );

		} );

		QUnit.test( 'getMixer', ( assert ) => {

			const { mixer, animationAction } = createAnimation();
			const mixer2 = animationAction.getMixer();
			assert.equal( mixer, mixer2, 'mixer should be returned by getMixer.' );

		} );

		QUnit.test( 'getClip', ( assert ) => {

			const { clip, animationAction } = createAnimation();
			const clip2 = animationAction.getClip();
			assert.equal( clip, clip2, 'clip should be returned by getClip.' );

		} );

		QUnit.test( 'getRoot', ( assert ) => {

			const { root, animationAction } = createAnimation();
			const root2 = animationAction.getRoot();
			assert.equal( root, root2, 'root should be returned by getRoot.' );

		} );

		// OTHERS
		QUnit.test( 'StartAt when already executed once', ( assert ) => {

			const root = new Object3D();
			const mixer = new AnimationMixer( root );
			const track = new NumberKeyframeTrack( '.rotation[x]', [ 0, 750 ], [ 0, 270 ] );
			const clip = new AnimationClip( 'clip1', 750, [ track ] );

			const animationAction = mixer.clipAction( clip );
			animationAction.setLoop( LoopOnce );
			animationAction.clampWhenFinished = true;
			animationAction.play();
			mixer.addEventListener( 'finished', () => {

				animationAction.timeScale *= - 1;
				animationAction.paused = false;
				animationAction.startAt( mixer.time + 2000 ).play();

			} );

			mixer.update( 250 );
			assert.equal( root.rotation.x, 90, 'first' );
			mixer.update( 250 );
			assert.equal( root.rotation.x, 180, 'first' );
			mixer.update( 250 );
			assert.equal( root.rotation.x, 270, 'first' );
			//first loop done
			mixer.update( 2000 );
			// startAt Done
			assert.equal( root.rotation.x, 270, 'third' );
			mixer.update( 250 );
			assert.equal( root.rotation.x, 180, 'fourth' );
			mixer.update( 250 );
			assert.equal( root.rotation.x, 90, 'fourth' );
			mixer.update( 250 );
			assert.equal( root.rotation.x, 0, 'sixth' );
			mixer.update( 1 );
			assert.equal( root.rotation.x, 0, 'seventh' );
			mixer.update( 1000 );
			assert.equal( root.rotation.x, 0, 'seventh' );
			mixer.update( 1000 );
			assert.equal( root.rotation.x, 0, 'seventh' );
			mixer.update( 250 );
			assert.equal( root.rotation.x, 90, 'seventh' );
			mixer.update( 250 );
			assert.equal( root.rotation.x, 180, 'seventh' );
			//console.log(mixer.time);

		} );

		QUnit.test( 'LoopRepeat with timeScale reversal during first loop', ( assert ) => {

			// Regression test for #19151
			const root = new Object3D();
			const mixer = new AnimationMixer( root );
			const track = new NumberKeyframeTrack( '.rotation[x]', [ 0, 1000 ], [ 0, 360 ] );
			const clip = new AnimationClip( 'clip1', 1000, [ track ] );

			const animationAction = mixer.clipAction( clip );
			animationAction.setLoop( LoopRepeat, Infinity );
			animationAction.play();

			// Advance partway into the first loop
			mixer.update( 500 );
			assert.equal( root.rotation.x, 180, 'At 500ms, rotation is 180 (halfway).' );

			// Reverse timeScale
			mixer.timeScale = - 1;

			// Step backward — should smoothly reverse, not jump
			mixer.update( 250 );
			assert.equal( root.rotation.x, 90, 'After reversing and stepping 250ms back, rotation is 90.' );

			mixer.update( 250 );
			assert.equal( root.rotation.x, 0, 'After reversing and stepping another 250ms back, rotation is 0 (start).' );

		} );

		QUnit.test( 'LoopPingPong with timeScale reversal during first loop', ( assert ) => {

			// Regression test for #19151
			const root = new Object3D();
			const mixer = new AnimationMixer( root );
			const track = new NumberKeyframeTrack( '.rotation[x]', [ 0, 1000 ], [ 0, 360 ] );
			const clip = new AnimationClip( 'clip1', 1000, [ track ] );

			const animationAction = mixer.clipAction( clip );
			animationAction.setLoop( LoopPingPong, Infinity );
			animationAction.play();

			// Advance partway into the first loop
			mixer.update( 500 );
			assert.equal( root.rotation.x, 180, 'At 500ms, rotation is 180 (halfway).' );

			// Reverse timeScale
			mixer.timeScale = - 1;

			// Step backward — should smoothly reverse, not jump
			mixer.update( 250 );
			assert.equal( root.rotation.x, 90, 'After reversing and stepping 250ms back, rotation is 90.' );

			mixer.update( 250 );
			assert.equal( root.rotation.x, 0, 'After reversing and stepping another 250ms back, rotation is 0 (start).' );

		} );

		QUnit.test( 'LoopPingPong clock is frame-subdivision independent while playing', ( assert ) => {

			// The same directed timeline (forward 1200 -> rewind 1400 -> forward 1400)
			// is driven with three frame schedules. Because a ping-pong revisits global
			// mixer times, the subdivisions are compared at the milestone reached at the
			// end of every directed segment: the rendered character position, the local
			// action time and the number of round-trips already consumed must be identical
			// there, however the elapsed time was split into frames.

			// Fine 200ms frames, grouped by direction into three segments.
			const fineSegments = [
				Array.from( { length: 6 }, () => [ 200, 1 ] ),
				Array.from( { length: 7 }, () => [ 200, - 1 ] ),
				Array.from( { length: 7 }, () => [ 200, 1 ] )
			];

			// Irregular frames whose boundaries land inside the rounds differently.
			const mediumSegments = [
				[[ 600, 1 ], [ 600, 1 ]],
				[[ 700, - 1 ], [ 700, - 1 ]],
				[[ 400, 1 ], [ 1000, 1 ]]
			];

			// One frame per segment; each large step crosses several rounds in a single
			// update, as happens when frames are dropped.
			const coarseSegments = [
				[[ 1200, 1 ]],
				[[ 1400, - 1 ]],
				[[ 1400, 1 ]]
			];

			const fine = runSegmentedSchedule( createPingPongRig(), fineSegments );
			const medium = runSegmentedSchedule( createPingPongRig(), mediumSegments );
			const coarse = runSegmentedSchedule( createPingPongRig(), coarseSegments );

			assertSameMilestones( assert, medium, fine, 'irregular frames' );
			assertSameMilestones( assert, coarse, fine, 'merged dropped frames' );

			// The shared milestones with explicit expected values. Local time is the
			// un-wrapped ping-pong phase; rendered position is where the character
			// actually stands on the [0, 360] track.
			assert.deepEqual( fine.milestones.map( ( frame ) => frame.mixerTime ), [ 1200, - 200, 1200 ],
				'The three milestones are reached at the expected global mixer times.' );
			assert.deepEqual( fine.milestones.map( ( frame ) => frame.position ), [ 288, 72, 288 ],
				'The rendered positions at the milestones are 288, 72, 288.' );
			assert.deepEqual( fine.milestones.map( ( frame ) => frame.actionTime ), [ 200, 800, 200 ],
				'The local action times at the milestones are 200, 800, 200.' );
			assert.deepEqual( fine.milestones.map( ( frame ) => frame.loopCount ), [ 1, 3, 5 ],
				'The consumed round-trip counts at the milestones are 1, 3, 5.' );

			// Fine frames sample every intermediate point; the position must follow the
			// triangular ping-pong wave exactly, landing on both endpoints along the way.
			assert.equal( fine.frames[ 4 ].position, 360, 'Fine frames reach the far endpoint (360) going out.' );
			assert.equal( fine.frames[ 11 ].position, 0, 'Fine frames reach the near endpoint (0) while rewinding.' );
			assert.equal( fine.frames[ 18 ].position, 360, 'Fine frames reach the far endpoint (360) again.' );

		} );

		QUnit.test( 'LoopPingPong loop events follow the frame boundaries and keep the signed distance', ( assert ) => {

			// Game logic accumulates the traveled distance from 'loop' notifications,
			// while rendering uses the sampled position. The number of notifications
			// and the distance each one stands for therefore depend on where the
			// frame boundaries are, but the signed total must match the clock state.

			// Fine frames: every crossed endpoint gets its own notification, each
			// spanning exactly one clip duration (signed loopDelta of +/- 1).
			const fineSchedule = [];
			for ( let i = 0; i !== 6; i ++ ) fineSchedule.push( [ 200, 1 ] );
			for ( let i = 0; i !== 7; i ++ ) fineSchedule.push( [ 200, - 1 ] );
			for ( let i = 0; i !== 7; i ++ ) fineSchedule.push( [ 200, 1 ] );

			const fineRig = createPingPongRig();
			const fineFrames = runSchedule( fineRig, fineSchedule );

			assert.equal( countEvents( fineFrames, 'loop' ), 5,
				'Fine frames produce one loop notification per crossed endpoint (5 crossings).' );
			assert.ok(
				fineFrames.every( ( frame ) => frame.events
					.filter( ( event ) => event.type === 'loop' )
					.every( ( event ) => Math.abs( event.loopDelta ) === 1 ) ),
				'Each fine-frame notification stands for exactly one directed endpoint.'
			);

			// Notifications while rewinding carry a negative distance, and the
			// round-trips already consumed before the reversal are preserved.
			const reverseNotifications = fineFrames
				.flatMap( ( frame ) => frame.events )
				.filter( ( event ) => event.type === 'loop' && event.loopDelta < 0 );
			assert.equal( reverseNotifications.length, 2, 'Rewinding across two endpoints fires two negative notifications.' );
			assert.deepEqual( reverseNotifications.map( ( event ) => event.loopDelta ), [ - 1, - 1 ],
				'The rewind notifications report -1 directed endpoint each.' );

			// Merged frames: one frame can jump over several rounds, so one
			// notification carries the full signed distance of that frame.
			const coarseFrames = runSchedule( createPingPongRig(), [
				[ 1200, 1 ],
				[ 1400, - 1 ],
				[ 1400, 1 ]
			] );

			assert.equal( countEvents( coarseFrames, 'loop' ), 3,
				'Merged frames produce one loop notification per frame that crosses endpoints.' );
			assert.deepEqual(
				coarseFrames.flatMap( ( frame ) => frame.events )
					.filter( ( event ) => event.type === 'loop' )
					.map( ( event ) => event.loopDelta ),
				[ 1, - 2, 2 ],
				'Each merged notification carries the signed number of endpoints crossed inside that frame.'
			);

			// Despite the different notification counts, the accumulated directed
			// distance is identical and matches the clock's round-trip count.
			assert.equal( signedLoopDistance( fineFrames ), signedLoopDistance( coarseFrames ),
				'The signed accumulated distance is independent of the frame split.' );
			assert.equal( signedLoopDistance( coarseFrames ), 1, 'The accumulated directed distance is +1.' );
			assert.equal( coarseFrames[ coarseFrames.length - 1 ].loopCount, 5,
				'The clock still counts all five consumed round-trips.' );

		} );

		QUnit.test( 'LoopPingPong finite repetitions report the finishing direction and keep a pose', ( assert ) => {

			// Forward exhaustion of a finite ping-pong (three rounds) with the last
			// frame kept: the finished event reports the forward direction and the
			// character stays on the held last pose for every later static frame.
			const fineSchedule = [];
			for ( let i = 0; i !== 35; i ++ ) fineSchedule.push( [ 100 ] );

			const clampRig = createPingPongRig( { repetitions: 3, clampWhenFinished: true } );
			const clampFrames = runSchedule( clampRig, fineSchedule );

			const finishFrame = clampFrames[ 29 ]; // mixer time 3000, the frame that exhausts the rounds
			assert.equal( finishFrame.events.length, 1, 'Exactly one event fires on the finishing frame.' );
			assert.equal( finishFrame.events[ 0 ].type, 'finished', 'The finishing frame dispatches finished.' );
			assert.equal( finishFrame.events[ 0 ].direction, 1, 'The finished event reports the forward (+1) direction.' );
			assert.notOk( clampRig.animationAction.isRunning(), 'The clamped action is paused and no longer running.' );
			assert.ok( clampRig.animationAction.paused, 'clampWhenFinished pauses the action.' );

			// The finishing frame samples the far end of the clip (rotation 0); once
			// the action is paused the clock feeds back its stored end time, and the
			// odd consumed round-trip count makes the ping-pong inversion return the
			// held far-end pose (rotation 360) on every following static frame.
			assert.equal( finishFrame.position, 0, 'The finishing frame renders the far end of the clip (0).' );
			assert.equal( clampFrames[ 30 ].position, 360, 'The next static frame holds the retained final pose (360).' );
			assert.equal( clampFrames[ 34 ].position, 360, 'Later static frames keep the retained final pose (360).' );

			// Releasing control instead disables the action, so the binding blends
			// back to the root's original rotation (11) on the finishing frame and
			// keeps returning it while the action stays inactive.
			const releaseRig = createPingPongRig( { repetitions: 3, clampWhenFinished: false } );
			const releaseFrames = runSchedule( releaseRig, fineSchedule );

			assert.equal( releaseFrames[ 29 ].events[ 0 ].direction, 1,
				'The released action also reports the forward finishing direction.' );
			assert.notOk( releaseRig.animationAction.enabled, 'A released action is disabled when finished.' );
			assert.equal( releaseFrames[ 29 ].position, 11,
				'The finishing frame hands the property back at its original value (11).' );
			assert.equal( releaseFrames[ 30 ].position, 11, 'The next static frame keeps the original value (11).' );
			assert.equal( releaseFrames[ 34 ].position, 11, 'Later static frames keep the original value (11).' );

			// A single dropped frame that exhausts everything at once must end in the
			// same states as the finely subdivided playback.
			const bigClampFrame = runSchedule( createPingPongRig( { repetitions: 3, clampWhenFinished: true } ), [[ 3000 ]] )[ 0 ];
			assert.equal( bigClampFrame.events[ 0 ].type, 'finished', 'A merged finishing frame still dispatches finished.' );
			assert.equal( bigClampFrame.events[ 0 ].direction, 1, 'A merged finishing frame still reports direction +1.' );
			assert.equal( bigClampFrame.position, 0, 'A merged finishing frame renders the same far end (0).' );

			const bigReleaseFrame = runSchedule( createPingPongRig( { repetitions: 3, clampWhenFinished: false } ), [[ 3000 ]] )[ 0 ];
			assert.equal( bigReleaseFrame.events[ 0 ].direction, 1, 'A merged released finish reports direction +1.' );
			assert.equal( bigReleaseFrame.position, 11, 'A merged released finish hands back the original value (11).' );

		} );

		QUnit.test( 'LoopPingPong finite repetitions finish backwards with direction -1', ( assert ) => {

			// Start a little into the first round, then rewind. With two repetitions
			// the reverse playback is exhausted at the near end of the clip and the
			// finished event must point into the reverse direction. Fine 100ms frames
			// cross the first endpoint through a normal wrap, then finish on the second.
			const fineSteps = [[ 100, 1 ]];
			for ( let i = 0; i !== 12; i ++ ) fineSteps.push( [ 100, - 1 ] ); // last reverse frame finishes
			fineSteps.push( [ 100 ], [ 100 ] ); // two further static frames

			const clampRig = createPingPongRig( { repetitions: 2, clampWhenFinished: true } );
			const clampFrames = runSchedule( clampRig, fineSteps );

			assert.deepEqual(
				clampFrames.flatMap( ( frame ) => frame.events )
					.filter( ( event ) => event.type === 'loop' )
					.map( ( event ) => event.loopDelta ),
				[ - 1 ],
				'Rewinding over the first endpoint fires one negative loop notification.'
			);

			const clampFinishIndex = findFrameIndex( clampFrames, ( frame ) =>
				frame.events.some( ( event ) => event.type === 'finished' ) );
			const clampFinish = clampFrames[ clampFinishIndex ];

			assert.equal( clampFinish.events[ 0 ].direction, - 1,
				'The finished event reports the reverse (-1) direction.' );
			assert.ok( clampRig.animationAction.paused, 'The clamped reverse action is paused.' );
			assert.equal( clampFinish.position, 0, 'The finishing frame renders the near end of the clip (0).' );
			assert.equal( clampFrames[ clampFinishIndex + 1 ].position, 360,
				'The next static frame holds the retained pose inverted by the odd round count (360).' );

			const releaseRig = createPingPongRig( { repetitions: 2, clampWhenFinished: false } );
			const releaseFrames = runSchedule( releaseRig, fineSteps );

			const releaseFinishIndex = findFrameIndex( releaseFrames, ( frame ) =>
				frame.events.some( ( event ) => event.type === 'finished' ) );
			assert.equal( releaseFrames[ releaseFinishIndex ].events[ 0 ].direction, - 1,
				'The released reverse finish also reports direction -1.' );
			assert.notOk( releaseRig.animationAction.enabled, 'The released reverse action is disabled.' );
			assert.equal( releaseFrames[ releaseFinishIndex ].position, 11,
				'The reverse finish hands the property back at its original value (11).' );
			assert.equal( releaseFrames[ releaseFinishIndex + 1 ].position, 11,
				'The next static frame keeps the original value (11).' );

			// One large reverse frame crossing both remaining rounds at once finishes in
			// the same direction, but the held pose differs from the fine subdivision:
			// a merged frame terminates inside the stop branch without updating the loop
			// count, so the even count keeps the near-end pose (0) instead of inverting it.
			const coarseSteps = [[ 100, 1 ], [ 2000, - 1 ], [ 300 ]];

			const coarseClamp = runSchedule(
				createPingPongRig( { repetitions: 2, clampWhenFinished: true } ), coarseSteps );
			const coarseClampFinish = findFrame( coarseClamp, ( frame ) =>
				frame.events.some( ( event ) => event.type === 'finished' ) );
			assert.equal( coarseClampFinish.events[ 0 ].type, 'finished', 'A merged reverse frame dispatches finished.' );
			assert.equal( coarseClampFinish.events[ 0 ].direction, - 1, 'A merged reverse frame reports direction -1.' );
			assert.equal( coarseClampFinish.position, 0, 'The merged reverse finish renders the near end (0).' );
			assert.equal( coarseClamp[ coarseClamp.length - 1 ].position, 0,
				'Static frames after a merged reverse finish keep the near-end pose (0).' );

			const coarseRelease = runSchedule(
				createPingPongRig( { repetitions: 2, clampWhenFinished: false } ), coarseSteps );
			const coarseReleaseFinish = findFrame( coarseRelease, ( frame ) =>
				frame.events.some( ( event ) => event.type === 'finished' ) );
			assert.equal( coarseReleaseFinish.events[ 0 ].direction, - 1,
				'A merged released reverse finish reports direction -1.' );
			assert.equal( coarseReleaseFinish.position, 11, 'A merged released reverse finish returns the original value (11).' );
			assert.equal( coarseRelease[ coarseRelease.length - 1 ].position, 11,
				'Static frames keep the original value (11).' );

		} );

	} );

} );
