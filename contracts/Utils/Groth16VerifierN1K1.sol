// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

library Groth16Verifier {
	error InvalidProofLength();
	error InvalidInstanceLength();
	error PrepareInstanceFailed();
	error PairingFailed();

	// solhint-disable const-name-snakecase
	uint256 private constant alphaX = 6716537280771956518800308181013190250439702505039832972712741726953612826500;
	uint256 private constant alphaY = 210952325962552053833899860973338766189892388225405657819601463505966458736;
	uint256 private constant betaX0 = 12048675906001726814752573161106514598413220245799381252101867931029981754019;
	uint256 private constant betaX1 = 16887805641222789802659080586468879948226247650376267919716561624695497548951;
	uint256 private constant betaY0 = 5598883262235482338135402235787499861442569388948591174172531479547040728402;
	uint256 private constant betaY1 = 9542364847073741488139200477959415047546169793377339200850190155302343567671;
	uint256 private constant gammaX0 = 19803992590437065963986906577451557800781969824991891937511783877773949857783;
	uint256 private constant gammaX1 = 10822560117522959156024893422949630875951195582422909832009458212995402618717;
	uint256 private constant gammaY0 = 7078259697098542397623449453900793521852684379268780201770303928100592672133;
	uint256 private constant gammaY1 = 5963652697837328000216697802606147978242513469024463192766808840312034816164;
	uint256 private constant deltaX0 = 15088760769498824897673383922248901994116975530352340614183800598758601846010;
	uint256 private constant deltaX1 = 12961294840844321473063864916548315460037654035074722176309321342803888366144;
	uint256 private constant deltaY0 = 1350237813528016146859447408830706822186621463460194197613542098323445660535;
	uint256 private constant deltaY1 = 11542377939649943790832196778343237197030872521063348045765543279378983643665;

	uint256 private constant ic000X = 9629374418282582819206961090781193937742539595711337220708615312725866091456;
	uint256 private constant ic000Y = 7362695866875829554843096369282838555585452298483901830330077779091185581366;

	uint256 private constant ic001X = 20101447887163815731480556086930858894703304818583589853647853865473874257662;
	uint256 private constant ic001Y = 20966789308643015067511089540769763856567743478127921110539193736018214969587;

	uint256 private constant ic002X = 11975620998997602089954052225377094206985695344389787135751051588006712795119;
	uint256 private constant ic002Y = 8624739211978091590403245484380057642394434072435413816299638884253301954193;

	uint256 private constant ic003X = 8531518735618944224974600222043094382593541128565877828562756065303567042893;
	uint256 private constant ic003Y = 1120571146435895593349869275857263035716587723255873146118738432307756872891;

	uint256 private constant ic004X = 2326305436935523794989548058630909189811490948644098682165194726492733251503;
	uint256 private constant ic004Y = 6524244905921190272387412760754402135425768683636798856026787280546531464795;

	uint256 private constant ic005X = 21482549497925631016386088557514236433819013337343212613520656753423208240060;
	uint256 private constant ic005Y = 12772462539579018226137192303280393073807118148304095380872690250748202642877;

	uint256 private constant ic006X = 13261813548250330276006203131837013288875464802006482090379372222000785467001;
	uint256 private constant ic006Y = 16332200994705455959215197334790630263587099167700644050769827281205227153361;

	uint256 private constant ic007X = 2893155683321197567878300775319902767753132239893871071181834520523678536186;
	uint256 private constant ic007Y = 8644054092580302012553979690696055026964049007862978235102094650729869771795;

	uint256 private constant ic008X = 11797254053771037407635777523980181829596848914106757307571149868417427221531;
	uint256 private constant ic008Y = 17055433941437739510144862931506697653916803272569624217567637681791342155779;

	// solhint-disable-next-line function-max-lines
	function _verify(uint256[8] calldata instance, uint256[8] calldata proof) public view returns (bool) {
		if (proof.length != 8) revert InvalidProofLength();
		if (instance.length != 8) revert InvalidInstanceLength();

		uint256[24] memory io;
		bool success = true;

		assembly {
			let g := sub(gas(), 2000)

			mstore(add(io, 0x240), ic000X)
			mstore(add(io, 0x260), ic000Y)

			mstore(add(io, 0x280), ic001X)
			mstore(add(io, 0x2a0), ic001Y)
			mstore(add(io, 0x2c0), calldataload(add(instance, 0x000)))
			success := and(success, staticcall(g, 0x07, add(io, 0x280), 0x60, add(io, 0x280), 0x40))
			success := and(success, staticcall(g, 0x06, add(io, 0x240), 0x80, add(io, 0x240), 0x40))

			mstore(add(io, 0x280), ic002X)
			mstore(add(io, 0x2a0), ic002Y)
			mstore(add(io, 0x2c0), calldataload(add(instance, 0x020)))
			success := and(success, staticcall(g, 0x07, add(io, 0x280), 0x60, add(io, 0x280), 0x40))
			success := and(success, staticcall(g, 0x06, add(io, 0x240), 0x80, add(io, 0x240), 0x40))

			mstore(add(io, 0x280), ic003X)
			mstore(add(io, 0x2a0), ic003Y)
			mstore(add(io, 0x2c0), calldataload(add(instance, 0x040)))
			success := and(success, staticcall(g, 0x07, add(io, 0x280), 0x60, add(io, 0x280), 0x40))
			success := and(success, staticcall(g, 0x06, add(io, 0x240), 0x80, add(io, 0x240), 0x40))

			mstore(add(io, 0x280), ic004X)
			mstore(add(io, 0x2a0), ic004Y)
			mstore(add(io, 0x2c0), calldataload(add(instance, 0x060)))
			success := and(success, staticcall(g, 0x07, add(io, 0x280), 0x60, add(io, 0x280), 0x40))
			success := and(success, staticcall(g, 0x06, add(io, 0x240), 0x80, add(io, 0x240), 0x40))

			mstore(add(io, 0x280), ic005X)
			mstore(add(io, 0x2a0), ic005Y)
			mstore(add(io, 0x2c0), calldataload(add(instance, 0x080)))
			success := and(success, staticcall(g, 0x07, add(io, 0x280), 0x60, add(io, 0x280), 0x40))
			success := and(success, staticcall(g, 0x06, add(io, 0x240), 0x80, add(io, 0x240), 0x40))

			mstore(add(io, 0x280), ic006X)
			mstore(add(io, 0x2a0), ic006Y)
			mstore(add(io, 0x2c0), calldataload(add(instance, 0x0a0)))
			success := and(success, staticcall(g, 0x07, add(io, 0x280), 0x60, add(io, 0x280), 0x40))
			success := and(success, staticcall(g, 0x06, add(io, 0x240), 0x80, add(io, 0x240), 0x40))

			mstore(add(io, 0x280), ic007X)
			mstore(add(io, 0x2a0), ic007Y)
			mstore(add(io, 0x2c0), calldataload(add(instance, 0x0c0)))
			success := and(success, staticcall(g, 0x07, add(io, 0x280), 0x60, add(io, 0x280), 0x40))
			success := and(success, staticcall(g, 0x06, add(io, 0x240), 0x80, add(io, 0x240), 0x40))

			mstore(add(io, 0x280), ic008X)
			mstore(add(io, 0x2a0), ic008Y)
			mstore(add(io, 0x2c0), calldataload(add(instance, 0x0e0)))
			success := and(success, staticcall(g, 0x07, add(io, 0x280), 0x60, add(io, 0x280), 0x40))
			success := and(success, staticcall(g, 0x06, add(io, 0x240), 0x80, add(io, 0x240), 0x40))

		}
		if (!success) revert PrepareInstanceFailed();

		assembly {
			// input 0x000 ~ 0x040 : A
			// input 0x040 ~ 0x0c0 : B
			mstore(io, calldataload(proof)) // A.X
			mstore(add(io, 0x020), calldataload(add(proof, 0x20))) // A.Y
			mstore(add(io, 0x040), calldataload(add(proof, 0x40))) // B.X0
			mstore(add(io, 0x060), calldataload(add(proof, 0x60))) // B.X1
			mstore(add(io, 0x080), calldataload(add(proof, 0x80))) // B.Y0
			mstore(add(io, 0x0a0), calldataload(add(proof, 0xa0))) // B.Y1

			// input 0x0c0 ~ 0x100 : alpha
			// input 0x100 ~ 0x180 : -beta
			mstore(add(io, 0x0c0), alphaX)
			mstore(add(io, 0x0e0), alphaY)
			mstore(add(io, 0x100), betaX0)
			mstore(add(io, 0x120), betaX1)
			mstore(add(io, 0x140), betaY0)
			mstore(add(io, 0x160), betaY1)

			// input 0x180 ~ 0x1c0 : C
			// input 0x1c0 ~ 0x240 : -delta
			mstore(add(io, 0x180), calldataload(add(proof, 0xc0))) // C.X
			mstore(add(io, 0x1a0), calldataload(add(proof, 0xe0))) // C.Y
			mstore(add(io, 0x1c0), deltaX0)
			mstore(add(io, 0x1e0), deltaX1)
			mstore(add(io, 0x200), deltaY0)
			mstore(add(io, 0x220), deltaY1)

			// input 0x280 ~ 0x300 : -gamma
			mstore(add(io, 0x280), gammaX0)
			mstore(add(io, 0x2a0), gammaX1)
			mstore(add(io, 0x2c0), gammaY0)
			mstore(add(io, 0x2e0), gammaY1)

			success := staticcall(sub(gas(), 2000), 0x08, io, 0x300, io, 0x020)
		}
		if (!success) revert PairingFailed();
		return io[0] == 1;
	}
}