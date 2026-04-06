// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

library Groth16Verifier {
	error InvalidProofLength();
	error InvalidInstanceLength();
	error PrepareInstanceFailed();
	error PairingFailed();

	// solhint-disable const-name-snakecase
	uint256 private constant alphaX = 16936881869601424192073075231048404332524070321909119764403157173522317115457;
	uint256 private constant alphaY = 3781415695295397738175021014294878636124762574869718040108285131690624045993;
	uint256 private constant betaX0 = 5251664862973457597585490953943331316889954843959545323970833560757010474087;
	uint256 private constant betaX1 = 11891674063949084050096147985961053787406981055754559882565272720769569970585;
	uint256 private constant betaY0 = 423050469127316656167494609946384851514575230038728410571703073149148563911;
	uint256 private constant betaY1 = 7284507847540035893201315024998894163616953193567653660541599662746382059014;
	uint256 private constant gammaX0 = 4062899489408529318032513725273256185966848908220652370105243147602200497868;
	uint256 private constant gammaX1 = 21142516759343111623175163122550740961711711108180566907518109196476838414701;
	uint256 private constant gammaY0 = 18565272213432771652327720476167623485313179277044530573903953128929754926395;
	uint256 private constant gammaY1 = 21022709947936811625089661790704244968716644236130774829387995746010336712232;
	uint256 private constant deltaX0 = 6144636476071473887801077339865074016527220961624278464558472004367258853054;
	uint256 private constant deltaX1 = 4032390314758340830549192557149603998468639710849227379163031852865670834776;
	uint256 private constant deltaY0 = 13113097488742084085340093936475002514238571873403099991999479654181332943735;
	uint256 private constant deltaY1 = 6766011302765892937091617589204525693541400189627272459944364695424402034077;

	uint256 private constant ic000X = 20554277488683003085468165217372636328597729596877632200257279071901942605762;
	uint256 private constant ic000Y = 20783730921616043776207894899664263336833059657013939995308741861810932966433;

	uint256 private constant ic001X = 19892459639436506334856084424553109642138182148603782189850941535457707786447;
	uint256 private constant ic001Y = 11031932032060075262589266519027268596381928012345821955300687788530619469599;

	uint256 private constant ic002X = 10376185750929509929565978632240010498994523549302794856739375630047005479553;
	uint256 private constant ic002Y = 15155762515074602489389863773173073026194322599790045360058434421933615201165;

	uint256 private constant ic003X = 162454071070069315828582361135387647240911139239045458978992992451050160698;
	uint256 private constant ic003Y = 18381199395041915903823927158097846747026454339930095072503528529881739876208;

	uint256 private constant ic004X = 3063083751395918704081804921212556112237363547169705117238208977308745896028;
	uint256 private constant ic004Y = 14673280971622206302277192607749077374626241650657319697685849610001237726285;

	uint256 private constant ic005X = 18017103033414719343889964200400493665511082076838969088073227805607793107280;
	uint256 private constant ic005Y = 1030016165498636736906434829786004366790470237055262298637329723574490517212;

	uint256 private constant ic006X = 12455153479790756402276406379041922499139702814058102280201503836399289544610;
	uint256 private constant ic006Y = 4162184168543087124686153045239253027724625576553020477493276370952991397224;

	uint256 private constant ic007X = 15055509809297350415361169840110489238623714124089795243413945527485378587161;
	uint256 private constant ic007Y = 10619028035960423052658279485922929843333116885230354922424671838241248747149;

	uint256 private constant ic008X = 2424936323938341503634894753274703358626629909489074113262844314839089800678;
	uint256 private constant ic008Y = 12936468494936242138301277726604484052515505441736278638481358484070236813692;

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