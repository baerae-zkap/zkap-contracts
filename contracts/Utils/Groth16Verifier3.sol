// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

library Groth16Verifier {
	error InvalidProofLength();
	error InvalidInstanceLength();
	error PrepareInstanceFailed();
	error PairingFailed();

	// solhint-disable const-name-snakecase
	uint256 private constant alphaX = 10543381608384319946660707743204841762819810942445506883902339687434061368130;
	uint256 private constant alphaY = 8230119143127685120678572243899313414249469268155783842478571298138923426300;
	uint256 private constant betaX0 = 16956800093681251984813980358938267366763417999122625538052980435200803668595;
	uint256 private constant betaX1 = 2721941858045635817348545874692198404196896051842222292943985038326710565509;
	uint256 private constant betaY0 = 9757804805886567576834773625261894635825543727683382828256315962380451848780;
	uint256 private constant betaY1 = 16750022914166447795175804471387800601427886899916232124496404832200611917893;
	uint256 private constant gammaX0 = 621386738547905871758247111220557027412982167939015681334050745200386713505;
	uint256 private constant gammaX1 = 8796349618343011919946229330972449716693757253682576708552884804869655434697;
	uint256 private constant gammaY0 = 3410332080040711589844362468487074574221145786432609194665060052875156082564;
	uint256 private constant gammaY1 = 18539492303647218931062530483771336834917698827510783871149329836655932207181;
	uint256 private constant deltaX0 = 15001281281424652050120591170458989573294716580416798497382586520572599375249;
	uint256 private constant deltaX1 = 5445626422095991764562384662853920318729617667320552187715967465127050102127;
	uint256 private constant deltaY0 = 6948872901998011778836754201089204647335552583854843497071700263382820801589;
	uint256 private constant deltaY1 = 18095674349608146107452413835664523154610543197798486597933019563510408835718;

	uint256 private constant ic000X = 11777168705219717942426806563795409933207835261873700377132356448551120023176;
	uint256 private constant ic000Y = 17064288607461925535602885437886840327416856272266819952989732596785249707011;

	uint256 private constant ic001X = 11808552538824802302358126781452371259181025471514516897862499613338832270243;
	uint256 private constant ic001Y = 4481660330061268751997701814126021595073666133359021608726306771778914977504;

	uint256 private constant ic002X = 16547510906647203596395989817388780653391260972818539615679840814415286611399;
	uint256 private constant ic002Y = 18173272207306599558773423987831503455088115171088110871423831945214870263780;

	uint256 private constant ic003X = 9668465714299307075989689584966044904089939409393556423367878595845818410651;
	uint256 private constant ic003Y = 19035615016160023144808560139593536728781676396829217732868895637362773480716;

	uint256 private constant ic004X = 16135369333622439723410453422860357463923238436741670239518139133146661888468;
	uint256 private constant ic004Y = 2188769086360949311344798627017467963877112677770947774307445522435936554496;

	uint256 private constant ic005X = 14592527597303405618868902143921471211301589554988568170534429903281929888527;
	uint256 private constant ic005Y = 16933825504538435193027016246293013932808616506061487288770605937925269708531;

	uint256 private constant ic006X = 1982077285243975102561051659653572448140622445317256524781453557677252144417;
	uint256 private constant ic006Y = 5962608887538420239626858887578073615275129883839282027547105266716823243935;

	uint256 private constant ic007X = 8428716221105032978769215000281233094495234971786217576648069827428775887649;
	uint256 private constant ic007Y = 10751407839171625611437957558973997576611462190497295541402329046934998932200;

	uint256 private constant ic008X = 18183385144483071280696803850208247805929321754116887236175643134065381029009;
	uint256 private constant ic008Y = 7416245518518448931598467220925173522496839444896235261881083413714319971702;

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