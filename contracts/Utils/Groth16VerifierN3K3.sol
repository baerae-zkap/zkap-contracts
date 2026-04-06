// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

library Groth16Verifier {
	error InvalidProofLength();
	error InvalidInstanceLength();
	error PrepareInstanceFailed();
	error PairingFailed();

	// solhint-disable const-name-snakecase
	uint256 private constant alphaX = 4415159723146034890608812588456686090004616941421542016006599642356380032292;
	uint256 private constant alphaY = 16208116940440521582344310499899770749588310731874212333312710826106384036246;
	uint256 private constant betaX0 = 18939912010745372296797769148971892600965378346999744449516763105851380580001;
	uint256 private constant betaX1 = 19627052157299513026508456284616717498709670956122526807081590894182142755782;
	uint256 private constant betaY0 = 14277439230515874137062375091290745565823500259260243269911322198060921512571;
	uint256 private constant betaY1 = 19632189899599987502521472867634523228679397352395158947009207390307956701630;
	uint256 private constant gammaX0 = 7677969750829547245024450942986436882937878967410366774990389893207394337282;
	uint256 private constant gammaX1 = 13730003888342446930238658339368419233976755978027299952645280639985214978005;
	uint256 private constant gammaY0 = 18372855916594090618687303184484312034494272753968376324786281654764778240621;
	uint256 private constant gammaY1 = 9481797194785992604866151143411294549220270208724770573260943915660838829250;
	uint256 private constant deltaX0 = 16479237041425431852595291500922219411707097884561902933771255471154071207136;
	uint256 private constant deltaX1 = 15975658114789697156230571980682952627425427942593773494553064648905593288233;
	uint256 private constant deltaY0 = 6378641993200887688960964946861664402165083379341877823701226597657839352728;
	uint256 private constant deltaY1 = 14022525168762003453252065419921447115836729140203924624356138544750590426841;

	uint256 private constant ic000X = 17939265289031895961439377953335517122624877745594502153745555689790726886031;
	uint256 private constant ic000Y = 13458264582451113954463092582622750164204129061458315670022084100947652667664;

	uint256 private constant ic001X = 2799332906474237657060648381203664016815604325661983752761797981149032270220;
	uint256 private constant ic001Y = 2487319289453856177079473161005381830757686520306274673287120090715458670097;

	uint256 private constant ic002X = 4066516840167350133697185205138166572234474310333229432140765309544473268840;
	uint256 private constant ic002Y = 21204289494140775448833924174516677489681499781343381530526380114473132308170;

	uint256 private constant ic003X = 2513743577641413638129853853229207109417788635318358733498342440423016887328;
	uint256 private constant ic003Y = 5763831603963626435015101688244223547323436433235254844030245248002558697526;

	uint256 private constant ic004X = 19546872717179722227723065035625472797349546828953528857879847957911326074862;
	uint256 private constant ic004Y = 11385943718582619021515127351997559787639036775813746944046558140565506125164;

	uint256 private constant ic005X = 409619020653020949127862804665099018474295491880248056567412050650784105132;
	uint256 private constant ic005Y = 20093842698811839279663380826585378562277476191455291298485127890860155378639;

	uint256 private constant ic006X = 10457792248414880329003606191435924519615499107125343191543031095477660579994;
	uint256 private constant ic006Y = 14532026604155844086407027056824014038803560648540041589438125308619078344449;

	uint256 private constant ic007X = 12764073945676852184157339721575005391111963267810052401862221299745631620769;
	uint256 private constant ic007Y = 2043369469745979170613222750893799982256050538555653505192175548138913077133;

	uint256 private constant ic008X = 8068996174834628787057819010887201664378964429956769815262960970447678247783;
	uint256 private constant ic008Y = 17393554120092788481971765370181866715364021559100576687869032634427867926017;

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