// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

library Groth16Verifier {
	error InvalidProofLength();
	error InvalidInstanceLength();
	error PrepareInstanceFailed();
	error PairingFailed();

	// solhint-disable const-name-snakecase
	uint256 private constant alphaX = 14082249664570222977387037067427405237093576303812036223842907593096732690878;
	uint256 private constant alphaY = 5133898789267062495066306941005903440385164363752272387201352935142040287430;
	uint256 private constant betaX0 = 3116661184682669621422361999009521254381404138465240825047787562786776018497;
	uint256 private constant betaX1 = 683403388022996871896113825508156312315576464105825244693145080342155833063;
	uint256 private constant betaY0 = 3246018494137281599368937616801649729688416125246429788658911526305348490550;
	uint256 private constant betaY1 = 17003581963711019769670847290401237004670955706393670227688436564201351518102;
	uint256 private constant gammaX0 = 4620589387318376505214609323643856496030692808305094113409730704399410109848;
	uint256 private constant gammaX1 = 17456819408723607221117963040044972820572312081761441620959286701097532921766;
	uint256 private constant gammaY0 = 3795727285985259968429991448806209847591469336743017714201293009496427230591;
	uint256 private constant gammaY1 = 3640228323066116285429786924702881912570784186240923624043032893503944849318;
	uint256 private constant deltaX0 = 19864706462764561670982689901842510251202329556045100096558108398759759264866;
	uint256 private constant deltaX1 = 2913115333206885835369430589946014400369726255258556670530598244203585861441;
	uint256 private constant deltaY0 = 16501115673175803721456419759659984309776070711766368403089785232205396392656;
	uint256 private constant deltaY1 = 11579961618308970333820626760495538677891659899442835810624947792031643858254;

	uint256 private constant ic000X = 1955590952522940335060089212062730484376565789031406675857404528573631331229;
	uint256 private constant ic000Y = 1291049654824354266351118311719789895423474266913716849099613264196059629415;

	uint256 private constant ic001X = 6644848316755465216489350679043404966600918139968793509475577571713530987225;
	uint256 private constant ic001Y = 446504818778195585731780732287211030865558983770885457019721055705732190668;

	uint256 private constant ic002X = 9500591232408180876674239241061406755611503946600257706962699231429181881728;
	uint256 private constant ic002Y = 21836645859093255716526863382284878588595399125666656611875658400846637064085;

	uint256 private constant ic003X = 9726515474400150074146691989063773238010171039867292241345428796776275441086;
	uint256 private constant ic003Y = 20887357836225313005089171441134687283319759132415959560847213198985435869563;

	uint256 private constant ic004X = 16144607756666131150519980458821411508124520027076249193735316324704415040765;
	uint256 private constant ic004Y = 21332991549750788179452540027439169488594270995781335164070504148176143469302;

	uint256 private constant ic005X = 20903306890143672335142786107593352326147944025930435804193180653681048858658;
	uint256 private constant ic005Y = 17250212233447993566257216391936901600389114914014568803725761595555929103900;

	uint256 private constant ic006X = 7275402584001683586258573259799095806219290263727981072947675993523713280724;
	uint256 private constant ic006Y = 17350247727954318109989238743560068007462185463164279146833776209023389539664;

	uint256 private constant ic007X = 19292036161433279578712334652746443730209131807414016229982910139207052608149;
	uint256 private constant ic007Y = 20564909481019098888479760301016059035654042677453068965860676799013259849818;

	uint256 private constant ic008X = 8726537437713009878561970469020126848820678422058671447539967542260238459585;
	uint256 private constant ic008Y = 2540078375598077787622019414346428696739314057827350331495560340084257001777;

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