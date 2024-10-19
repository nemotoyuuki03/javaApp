import java.awt.Graphics;
import java.awt.image.BufferedImage;

public class Player 
{
    private BufferedImage playerImage; // プレイヤー画像
    private int width;  // 幅
    private int height; // 高さ

    // コンストラクタ
    public Player(BufferedImage image, int width, int height) 
    {
        this.playerImage = image;
        this.width = width;
        this.height = height;
    }

    // 描画メソッド
    public void draw(Graphics g, int windowHeight) 
    {
        // プレイヤーのY座標を計算
        int destX = 10; // 描画位置Xを左端に
        int destY = (windowHeight - height) / 2; // Y座標をウィンドウの中央に

        // プレイヤーを描画
        g.drawImage(playerImage, destX, destY, 
                    destX + width, destY + height, 
                    0, 0, 
                    width, height, 
                    null);
    }
}
